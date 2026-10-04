# ADR 0003 — Phase 5: End-to-end Integration Decisions

- **Status:** Accepted
- **Date:** 2026-10-04
- **Phase:** 5 (End-to-end integration) — see [`plan/phase-5.md`](../../plan/phase-5.md)
- **Scope:** Records the §1 (orchestrator entry point) and §2 (configuration surface and
  precedence) decisions. Later sections are recorded here as they land.

## Context

Phases 1–4 produced four independent CLIs. Phase 5 adds a single orchestrator that composes
their stage functions, plus the configuration surface and precedence rules that keep the
basic command argument-free. No analysis or rendering logic is re-implemented.

---

## Decision 1 — Orchestrator entry point and run-directory contract (§1)

**Decision.** Ship one end-to-end command, `src/cli/explainBranchVideo.ts` (`npm run explain`),
that runs **inspect → plan → narrate → render → validate** in-process:

- The four stage bodies are factored into `src/pipeline/stages.ts` as `runInspect`, `runPlan`,
  `runNarrate`, and `runRender`. Each standalone CLI and the orchestrator call the same
  functions, so behaviour cannot diverge. The stage CLIs remain independently runnable.
- All stages share one **run directory**, `artifacts/<run-id>/` (run id = sanitised branch
  name), resolved by `resolveRunDir`. It holds `branch-plan.json` (pre-narration checkpoint),
  `plan.json` (narrated plan written by the narration stage), `audio/<scene-id>.<format>`, and
  `render-input.json`. The MP4 defaults to `artifacts/branch-explainer.mp4`.
- The run is **resumable**: a valid `<run-dir>/plan.json` is reused (planning + narration
  skipped) unless `--force`; `narratePlan`'s cache skips already-generated clips, so a failed
  render never re-bills for audio.
- The orchestrator is read-only with respect to tracked source; the only writes are artifacts
  under the run directory and the output MP4.

**Rationale.** In-process composition keeps typed errors and results first-class, avoids
duplicated pipeline logic, and makes the plan/audio checkpoint the natural resume unit.

## Decision 2 — Configuration surface, defaults, and precedence (§2)

**Decision.** The orchestrator exposes one flat flag set and resolves repository defaults once.

| Flag                                                                 | Maps to                                                      | Default                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `--base <ref>`                                                       | `buildChangeInventory({ base })`                             | auto-resolved (flag > project config > upstream > `main`/`master`)     |
| `--include-working-tree`                                             | inventory working tree                                       | `false`                                                                |
| `--max-scenes <n>`                                                   | `buildPlan({ maxScenes })`                                   | `5`, overridable via project config                                    |
| `--voice` / `--model` / `--provider` / `--format` / `--instructions` | `NarrationConfigOverrides`                                   | `marin` / `gpt-4o-mini-tts` / `openai` / `wav` / built-in instructions |
| `--out <path>`                                                       | `resolveOutputPath`                                          | `artifacts/branch-explainer.mp4`                                       |
| `--run-id` / `--run-dir`                                             | run directory                                                | branch name / `<repo>/artifacts/<run-id>`                              |
| `--force`                                                            | ignore the resume checkpoint                                 | `false`                                                                |
| `--overwrite`                                                        | allow replacing an existing output                           | `false`                                                                |
| `--dry-run`                                                          | plan + cost estimate only; no audio, no render, no writes    | `false`                                                                |
| `--stdout`                                                           | plan-only mode: print the scene plan JSON to stdout and stop | `false`                                                                |
| `--repo <path>`                                                      | path inside the repository                                   | cwd                                                                    |

**Narration precedence** (implemented by `resolveNarrationConfig`, invoked once by the
orchestrator and passed to the narration stage):

1. CLI flag (highest)
2. `.explain-branch.json` → `narration` object
3. `package.json` → `explainBranch.narration` object
4. environment → `EXPLAIN_BRANCH_TTS_*` variables
5. built-in defaults (lowest)

**Project defaults.** A repository can set defaults once in `.explain-branch.json` or the
`explainBranch` field of `package.json`:
`{ "base": "main", "maxScenes": 5, "narration": { ... } }`.

- `base` is read by the Git inspector (`readConfiguredBase`, plan §6).
- `maxScenes` is read by `readConfiguredMaxScenes` (`src/pipeline/projectConfig.ts`) and used
  only when `--max-scenes` is absent, so an explicit flag always wins.
- `narration` is read by the narration config resolver as layer 2/3 above.

**Rationale.** One place resolves each setting, precedence is explicit and matches the
documented order, and the pipeline runs with no arguments while remaining overridable.

---

## Open items

- Confirm the invocation token and the skill→CLI argument contract at the Codex-surface step
  (recorded in §6 of the phase plan).
