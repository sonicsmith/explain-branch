# Phase 5 — End-to-end Integration

> Source: [`overview.md`](./overview.md) §13 (Phase 5), §11 (plugin interaction & configuration),
> §2 (target UX), §12 (project layout), §14 (acceptance criteria) and §15 (engineering
> principles); builds on [`phase-4.md`](./phase-4.md) and
> [`../docs/adr/0001-tooling-decisions.md`](../docs/adr/0001-tooling-decisions.md) (entry point /
> invocation) plus [`../docs/adr/0002-phase-4-narration-decisions.md`](../docs/adr/0002-phase-4-narration-decisions.md).
> **Goal:** Chain the already-working stages — Git inspection → planning → narration → rendering
> → validation — into one command invoked from the Codex skill, with progress reporting,
> actionable errors, and outputs that never overwrite existing files.
> **Deliverable:** Invoke the workflow in a real repository and receive a narrated branch
> explainer, with the plan JSON, narration script, and audio kept alongside the MP4.

## Objective

Phases 1–4 produced four independent, tested CLIs:

| Stage   | CLI                        | `npm run`         | Writes                                     |
| ------- | -------------------------- | ----------------- | ------------------------------------------ |
| Inspect | `src/cli/explainBranch.ts` | `inspect`         | nothing (stdout)                           |
| Plan    | `src/cli/planBranch.ts`    | `plan`            | `artifacts/branch-plan.json`               |
| Narrate | `src/cli/narrateBranch.ts` | `narrate`         | `<run-dir>/plan.json` + `<run-dir>/audio/` |
| Render  | `src/cli/renderBranch.ts`  | `render:narrated` | `<run-dir>/render-input.json` + MP4        |

Phase 5 adds **one orchestrator** that runs the whole sequence under a single **run
directory**, streams progress, maps every failure to an actionable message and exit code,
and never leaves the repository changed or overwrites an existing output. The Codex skill
(`skills/explain-branch/SKILL.md`) becomes the real entry point and points at that
orchestrator instead of the individual scripts.

**Current state to build on (already implemented):**

- `buildChangeInventory` raises `BaseResolutionError` (exit 2) when the base is ambiguous.
- `buildPlan` returns `{ plan, snapshot }`; `validatePlan` guards it.
- `narratePlan` is cache-aware, idempotent, and returns `{ plan, clips, costEstimate }`; it
  needs `OPENAI_API_KEY` unless `dryRun` is set.
- `validateNarratedPlan` checks schema + source refs + the clips themselves.
- `resolveOutputPath` gives a timestamped, non-colliding path unless `overwrite` is set.
- Run layout is already stable: `artifacts/<run-id>/plan.json`, `.../audio/<scene-id>.wav`,
  `.../render-input.json`; `renderBranch.ts` captures sources via `capturePlanSnapshot`.

**Do not re-implement the stages.** Phase 5 is composition, configuration, progress, error
mapping, output management, and skill wiring — not new analysis or rendering logic.

---

## 1. Orchestrator entry point

- [ ] Add `src/cli/explainBranchVideo.ts` — the single end-to-end command (working name
      `npm run explain`) that runs: inspect → plan → narrate → render → validate.
- [ ] Reuse the existing stage functions in-process rather than shelling out to the four
      CLIs, so types and errors stay first-class. Factor each stage's body out of its CLI
      into a callable module where it is currently inline (e.g. `runInspect`, `runPlan`,
      `runNarrate`, `runRender`) and have both the stage CLI and the orchestrator call it.
- [ ] Choose one **run directory** up front (`artifacts/<run-id>/`) and thread it through
      every stage so plan, audio, `render-input.json`, and the MP4 land together. Reuse
      `defaultRunId(plan)` from `narrateBranch.ts` (branch name, sanitised) as the standard.
- [ ] Make the orchestrator resumable: if `<run-dir>/plan.json` (narrated) already exists and
      is valid, reuse it instead of re-planning; `narratePlan` already skips cached clips, so
      a failed render can be retried without re-billing.
- [ ] Keep every stage independently runnable — the four CLIs stay as documented, the
      orchestrator is additive.

**Decision to record:** entry-point name, in-process vs. subprocess composition, and the run
directory contract.

## 2. Configuration surface and precedence

- [x] Expose one flag set on the orchestrator, mapping to the existing stage options where
      they already exist and adding only what is missing (§11). Suggested surface:

      | Flag | Maps to | Default |
      | ---- | ------- | ------- |
      | `--base <ref>` | `buildChangeInventory({ base })` | auto-resolved |
      | `--include-working-tree` | inventory working tree | `false` |
      | `--max-scenes <n>` | `buildPlan({ maxScenes })` | `5` |
      | `--voice` / `--model` / `--provider` / `--format` / `--instructions` | `NarrationConfigOverrides` | `marin` / `gpt-4o-mini-tts` / `openai` / `wav` |
      | `--out <path>` | `resolveOutputPath` | `artifacts/branch-explainer.mp4` |
      | `--run-id` / `--run-dir` | run directory | branch name |
      | `--dry-run` | skip TTS + render; report plan + cost | `false` |
      | `--overwrite` | allow replacing existing outputs | `false` |
      | `--stdout` | print the plan instead of writing | `false` |

- [x] Apply the documented precedence for narration config: CLI flag > `.explain-branch.json`
      `narration` > `package.json` `explainBranch.narration` > `EXPLAIN_BRANCH_TTS_*` env >
      built-in defaults. `resolveNarrationConfig` already implements this — call it once and
      pass the resolved config to the narration stage.
- [x] Extend project config to carry a default **base** and **max-scenes** if not already
      covered by `explainBranch.base`, so a repo can set defaults once.
- [x] Keep the basic command argument-free: defaults must produce a complete narrated video.

**Decision to record:** the exact flag names, defaults, and precedence table.

## 3. Progress reporting and pre-flight disclosure

- [x] **State the plan before long work** (§11): print branch, resolved base (and its source),
      whether working-tree changes are included, scene count target, chosen voice/model, and
      the planned output path before any TTS or render call.
- [x] Emit stage banners (`[1/5] inspect`, `[2/5] plan`, …) to **stderr**, keeping **stdout**
      reserved for the final machine-readable result (report JSON) so callers can parse it.
- [x] Surface the narration stage's existing `onProgress` events (per-scene "generating" /
      "retrying" / "done") and a render progress line; do not add a dependency — reuse the
      `NarrationProgressEvent` stream and Remotion's own output.
- [x] Clearly mark dry-run output (`[dry run]`) so it is never mistaken for a real render.
- [x] Keep all human-readable chatter off stdout; the final result line/paths go to stdout.

**Decision to record:** stdout vs. stderr split, and the pre-flight disclosure contents.

## 4. Error handling, exit codes, and recoverability

- [x] Map every stage failure to a single, actionable message and a stable exit code, reusing
      the codes already established:

      | Condition | Exit | Message must say |
      | --------- | ---- | ---------------- |
      | Base ambiguous | `2` | which refs were considered; pass `--base <ref>` |
      | Invalid narration config | `2` | which option and the accepted values |
      | Plan unreadable / invalid | `3` | the file path and the validation issues |
      | Missing / rejected `OPENAI_API_KEY` | `4` | how to obtain and export the key |
      | Render failed (FFmpeg/Chrome) | stage code / `1` | the failing command + that clips/plan were kept |
      | Other | `1` | the underlying error, untruncated |

- [x] **Fail recoverable, not clean** (§15): on TTS or render failure, keep the run directory
      (plan + already-generated clips + `render-input.json`) and tell the user the exact
      command to resume — e.g. re-run and it will skip cached audio.
- [x] Never leave the repository changed on failure: assert (and document) that no stage
      checks out, resets, stashes, commits, or writes to tracked files; all writes stay under
      `artifacts/` or `--out`.
- [x] When credentials are missing, **stop before** planning/narrating and state that a
      narrated video cannot be produced — never fall back to a silent render silently.

**Decision to record:** the full exit-code table and the resume contract.

## 5. Output management and the run report

- [x] Write the final MP4 through `resolveOutputPath`; without `--overwrite`, a collision
      produces a timestamped path and a notice — never a silent replace (§2/§15).
- [x] Save the required artifacts **alongside** the video (§14.9): the validated plan JSON,
      the narration script, and the `render-input.json` used, all inside the run directory.
- [x] Write a machine-readable **run report** (`<run-dir>/report.json`) recording: branch, base + source, commit, whether working tree was included, scene count, per-scene audio path +
      duration, total duration, MP4 path + size, omitted changes, caveats, redactions applied,
      and the cost estimate. Print the same summary to stdout and the human summary to stderr.
- [x] Report material **omissions and caveats** from the plan (§14.10) and any redactions the
      narration pre-flight applied.
- [x] Verify the rendered MP4 exists and is non-empty before reporting success; treat a missing
      or zero-byte output as a render failure.

**Decision to record:** report schema/version and which artifacts are always written.

## 6. Skill and plugin wiring

- [x] Update `skills/explain-branch/SKILL.md`: replace the stale "Phase 3 / silent renderer"
      status with the real workflow, pointing at the orchestrator as the single command and
      listing the flags, defaults, exit codes, and the `OPENAI_API_KEY` requirement.
- [x] Confirm the invocation token (`$explain-branch` in Codex; `/explain-branch` on the
      Claude surface) and how the skill passes arguments to the orchestrator (env
      `PLUGIN_ROOT`, cwd, argv). Record the verified contract.
- [x] Keep the skill honest: it must state that a silent video is never produced when
      credentials are absent, and must never claim narration it did not generate.
- [x] Bump versions: `package.json` and `plugin.json` to the Phase 5 version (e.g. `0.5.0`),
      and update the `plugin.json` `extensions.com.openai` description if the capability set
      changes.
- [x] Add a `skills/explain-branch/references/` entry (plan schema + flag reference) or reuse
      the existing docs so the skill and the code do not drift.

**Decision to record:** the invocation/argument contract between the skill and the CLI.

## 7. Testing and smoke test

- [x] Add an **offline end-to-end test** for the orchestrator using the fake TTS provider and a
      temp-repo fixture: inspect → plan → narrate → render-input → (render skipped or a
      minimal composition), asserting the report, artifact layout, exit code, and that no
      tracked file changed.
- [x] Test each mapped failure path returns the documented exit code and message: ambiguous
      base, missing key, invalid plan, output collision.
- [x] Test resumability: a run whose render "fails" keeps the plan + clips, and a second run
      reuses them without regenerating audio.
- [x] Keep the existing **manual** real-API smoke test in `docs/manual-smoke-test.md` as the
      final end-to-end proof (requires `OPENAI_API_KEY` + network, excluded from `npm test`);
      extend it to drive the orchestrator, not the individual CLIs.
- [x] Ensure `npm test` and `npm run typecheck` stay green and that new tests need no network.

**Decision to record:** how the orchestrator is tested offline and what the smoke test covers.

## 8. Documentation

- [ ] Update `README.md`: the one-command quick start, `OPENAI_API_KEY` setup, output layout,
      exit codes, and the privacy/data-transmission note (already present) restated for the
      end-to-end flow.
- [ ] Document the run directory and report schema so a failed run can be inspected and
      resumed.
- [ ] Document limitations honestly: large branches may omit changes; TTS requires a key and
      network; diagrams are optional; no branch switching or source modification.

**Decision to record:** the single authoritative usage doc and what it must contain.

---

## Deliverables

1. `src/cli/explainBranchVideo.ts` (name TBD) — one command running inspect → plan → narrate →
   render → validate, resumable and dry-runnable.
2. Stage functions factored out of the four CLIs and reused by both the CLIs and the
   orchestrator (no duplicated pipeline logic).
3. A stable run-directory layout plus `<run-dir>/report.json` recording every relevant fact.
4. Updated `skills/explain-branch/SKILL.md` and `plugin.json`/`package.json` at the Phase 5
   version, pointing at the orchestrator.
5. Offline end-to-end + failure/resume tests, and an extended manual smoke test.
6. A single narrated branch explainer produced end-to-end in a real repository.

## Exit criteria (§14 subset)

- [ ] One command, invoked from the Codex skill, produces a playable narrated MP4.
- [ ] The branch and a correct, explicit base are identified — or the run asks/stops with exit 2.
- [ ] The inventory is produced without modifying the repository; no stage changes branch or files.
- [ ] The plan contains several meaningful changes (not one scene per file) and references real
      source locations.
- [ ] The scene plan JSON, narration script, and audio are saved alongside the video.
- [ ] The exact output path, omissions, caveats, and redactions are reported.
- [ ] Errors are actionable and leave the repository unchanged; a failed render can be resumed.
- [ ] Existing outputs are never overwritten without `--overwrite`.
- [ ] Progress is streamed and the plan (branch/base/working-tree/voice/output) is stated before
      long work.
- [ ] `npm test` and `npm run typecheck` pass; the orchestrator is tested offline.

## Handoff to Phase 6

Once the pipeline runs end-to-end behind the skill, proceed to **Phase 6 only**: robustness and
quality — varied repository sizes/languages, deleted/moved code and stale line references,
scene selection and pacing, missing credentials / network / render failures / cancellation, and
final setup/usage/limitations/troubleshooting docs plus a repeatable ending smoke test.
