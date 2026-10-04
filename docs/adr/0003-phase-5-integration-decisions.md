# ADR 0003 — Phase 5: End-to-end Integration Decisions

- **Status:** Accepted
- **Date:** 2026-10-04
- **Phase:** 5 (End-to-end integration) — see [`plan/phase-5.md`](../../plan/phase-5.md)
- **Scope:** Records the §1 (orchestrator entry point), §2 (configuration surface and
  precedence), §3 (progress reporting and stdout/stderr split), §4 (error handling, exit codes,
  and recoverability), §5 (output management and the run report), and §6 (skill and plugin
  wiring) decisions. Later sections are recorded here as they land.

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

## Decision 3 — Progress reporting and the stdout/stderr split (§3)

**Decision.** All progress, disclosure, and human-readable chatter goes to **stderr**; **stdout**
carries only the final machine-readable result.

- **Pre-flight disclosure** (printed after the inspect banner, before any TTS or render call and
  before the config/credential errors surface): branch, resolved base + its source,
  working-tree state (included or not), run directory, scene-count target, narration
  voice/model/format, and the planned output path. Under `--dry-run` the output line is
  replaced by an explicit "(dry run — …)" marker.
- **Stage banners** `[1/5] … [5/5]` are written to stderr, as are narration `onProgress`
  events (`generating` / `retrying` / `cached` / …), the render line, warnings, and the human
  "Rendered: …" summary.
- **stdout contract:** the run report JSON on success (see Decision 5); the scene-plan JSON
  with `--stdout`; a small JSON summary (`dryRun`, `scenes`, `totalCharacters`,
  `estimatedCostUsd`, `costBasis`) with `--dry-run`.
- **Remotion's own output** is forwarded to stderr (`stdio: ["inherit", process.stderr,
process.stderr]`), so the renderer cannot pollute stdout.
- **Dry-run** lines are prefixed `[dry run]` so they are never mistaken for a real render.

**Rationale.** Callers (and the skill) can parse stdout deterministically while a human reads
the live progress on stderr.

## Decision 4 — Error handling, exit codes, and recoverability (§4)

**Decision.** Every stage failure maps to one actionable stderr message and a stable exit code.

| Condition                           | Exit                 | Message says                                                        |
| ----------------------------------- | -------------------- | ------------------------------------------------------------------- |
| Base ambiguous                      | `2`                  | which refs were considered; pass `--base <ref>` (or project config) |
| Invalid narration config            | `2`                  | which option and the accepted values                                |
| Plan unreadable / invalid           | `3`                  | the plan path and the validation issues                             |
| Missing / rejected `OPENAI_API_KEY` | `4`                  | how to obtain and export the key                                    |
| Render failed (FFmpeg/Chrome)       | renderer's exit code | the failing command + that the plan/clips were kept                 |
| Other                               | `1`                  | the underlying error, untruncated                                   |

- **Fail fast on credentials.** When narration will run (not `--dry-run`, no resume), the
  orchestrator checks `OPENAI_API_KEY` _before_ planning. A missing/rejected key stops the run
  with exit `4` and a setup message — it never falls back to a silent render.
- **Fail recoverable, not clean.** On a TTS or render failure the run directory is kept
  (`branch-plan.json`, `plan.json`, already-generated clips, `render-input.json`) and the CLI
  reports the exact resume command (`npm run explain`) plus `--force` to regenerate. Cached
  clips make the retry cheap.
- **Rendered command is surfaced.** `runRender` returns the renderer command it ran so the
  failure message can name it.
- **Repository-unchanged assertion.** After any failure the orchestrator re-reads `HEAD` and the
  current branch and asserts they match the values captured at start; a mismatch is reported
  loudly with exit `1`. Documentation states the invariant: no stage checks out, resets,
  stashes, commits, or writes tracked files — all writes stay under `artifacts/` or `--out`.

**Rationale.** Codes are stable and already used by the stage CLIs; recoverability (kept
artifacts + cached clips) makes failures resumable without re-billing, and the assertion backs
the read-only guarantee with a runtime check.

## Decision 5 — Output management and the run report (§5)

**Decision.** Every run produces a stable, self-describing set of artifacts under the run
directory, and a machine-readable report is the CLI's stdout result.

- **No silent overwrite.** The MP4 goes through `resolveOutputPath`: without `--overwrite` a
  collision yields a timestamped path and a notice; Remotion is also passed `--overwrite=false`.
- **Artifacts alongside the video** (§14.9), all in `<run-dir>/`:
  - `plan.json` — the validated, narrated (redacted) plan,
  - `narration.txt` — the narration script (title + per-scene narration text),
  - `render-input.json` — exactly what was passed to the renderer,
  - `audio/<scene>.<fmt>` — the clips,
  - `report.json` — the run report (below),
  - plus `branch-plan.json` as the pre-narration resume checkpoint.
- **Run report** (`src/pipeline/report.ts`, `REPORT_SCHEMA_VERSION = 1`) records: schema
  version + timestamp; branch, HEAD, base (ref/source/merge-base); working-tree state and
  whether it was included; scene count; narration provider/model/voice/format; per-scene clips
  (audio path + measured duration); total narration and video durations; the MP4 path + byte
  size; plan omissions and caveats; redactions applied; the cost estimate; and the artifact
  paths. It is written to `<run-dir>/report.json` **and** printed to stdout; the same summary is
  rendered human-readably to stderr (`formatReportSummary`).
- **Success requires a real file.** After the renderer exits 0 the orchestrator verifies the
  MP4 exists and is non-empty (`verifyRenderedVideo`); a missing/zero-byte file is treated as a
  render failure (exit 1) with the plan/clips kept for resume.
- **Omissions, caveats, and redactions are surfaced** both in the report and the stderr summary.

**Rationale.** A single versioned report makes the run inspectable and machine-consumable, the
narration script and plan travel with the video, and verifying the output prevents a
false-success when the renderer writes nothing.

## Decision 6 — Skill and plugin wiring (§6)

**Decision.** The skill invokes the orchestrator and is honest about credentials and versions.

- **Invocation contract.** The Codex surface triggers the skill as `$explain-branch` (the
  Claude/other surface uses `/explain-branch`). The host sets `PLUGIN_ROOT` to the plugin
  directory and runs the skill with the **target repository as cwd**. The skill runs:
  `node "${PLUGIN_ROOT}/src/cli/explainBranchVideo.ts" [flags…]` and passes flags through as
  **argv**; relative paths resolve against the cwd (the repository being explained) unless
  `--repo` is given.
- **Skill honesty.** `SKILL.md` states that narration requires `OPENAI_API_KEY`, that a missing
  key stops the run (exit 4) _before_ planning, and that a silent video is never produced in its
  place — the skill must not claim narration it did not generate.
- **Docs beside the skill.** `skills/explain-branch/references/flags.md` (flag reference for the
  orchestrator and the stage CLIs) and `references/plan-schema.md` (plan + report schemas, the
  run-directory layout, and the privacy note) keep the skill and code from drifting.
- **Versions.** `package.json` and `plugin.json` are bumped to `0.5.0`. The
  `extensions.com.openai` capability set is unchanged (still `["Read"]` for repository access;
  writes are local artifacts), so its description is left as-is.

**Rationale.** A single documented command and a filename/argv contract make the skill a thin,
verifiable wrapper; keeping schemas and flags next to the skill prevents documentation drift.

---

## Open items

- Confirm the invocation token and the skill→CLI argument contract at the Codex-surface step
  (recorded in §6 of the phase plan).
