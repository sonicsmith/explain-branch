# explain-branch

A Codex plugin/skill that analyses the current Git branch and produces a **narrated
explainer video** showing what changed, how the changed code works, and how it fits the
wider application.

> **Status: Phase 6 — agent-authored, multi-step walkthroughs.** Explanations are authored by
> the host coding agent (scaffold → author → render), not generated mechanically, and each code
> scene walks through the change a few lines at a time. See [`plan/overview.md`](plan/overview.md),
> [`plan/phase-6.md`](plan/phase-6.md) and
> [`docs/adr/0004-agent-authored-explanations.md`](docs/adr/0004-agent-authored-explanations.md).

## Layout

```text
.
├── plugin.json                     # portable Agent Plugins manifest (entry point)
├── .codex-plugin/plugin.json       # Codex compatibility manifest (skills path)
├── skills/
│   └── explain-branch/
│       ├── SKILL.md                # skill instructions + trigger
│       └── scripts/hello.ts        # Phase 0 placeholder script
├── src/
│   ├── git/
│   │   ├── git.ts                  # safe, read-only Git runner
│   │   ├── parseDiff.ts            # unified-diff parser
│   │   └── inspectBranch.ts        # branch/base resolution
│   ├── analysis/
│   │   ├── buildChangeInventory.ts # structured change inventory
│   │   ├── fileClassification.ts   # language + generated-file detection
│   │   ├── sourceSnapshot.ts       # read-only source capture
│   │   └── validatePlan.ts         # plan schema validation
│   ├── planning/
│   │   ├── types.ts                # versioned scene-plan schema (v3, multi-step)
│   │   ├── paths.ts                # path-safety checks
│   │   └── buildPlan.ts            # deterministic scaffold builder (no narration)
│   ├── cli/
│   │   ├── explainBranch.ts        # inspection CLI
│   │   ├── planBranch.ts           # scaffold CLI (agent authors the plan next)
│   │   ├── narrateBranch.ts        # narration CLI
│   │   ├── renderBranch.ts         # narrated-render CLI
│   │   └── explainBranchVideo.ts   # narrate+render orchestrator (entry point; needs --plan)
│   ├── pipeline/                   # Phase 5 composition
│   │   ├── stages.ts               # runInspect/runScaffold/validateAuthoredPlan/runNarrate/runRender
│   │   ├── report.ts               # run report + output artifacts
│   │   ├── projectConfig.ts        # base/maxScenes repo defaults
│   │   └── testHooks.ts            # offline test seams (env-gated)
│   ├── narration/                  # Phase 4 text-to-speech narration
│   │   ├── config.ts               # provider/model/voice/format configuration
│   │   ├── credentials.ts          # OPENAI_API_KEY handling
│   │   ├── narratePlan.ts          # per-scene clips + cache
│   │   ├── duration.ts / wav.ts    # duration measurement
│   │   ├── retry.ts                # backoff for transient failures
│   │   ├── redact.ts               # pre-flight secret redaction
│   │   └── validateNarration.ts    # plan + audio validation
│   └── render/                     # Remotion compositions (Phase 3+4)
│       ├── index.ts                # registerRoot entry point
│       ├── Root.tsx                # composition + timeline metadata
│       ├── ExplainerVideo.tsx      # scene sequencing
│       ├── timeline.ts             # narration-driven scene timing
│       ├── steps.ts                # step windows for multi-step scenes
│       ├── chunkTiming.ts          # proportional frame distribution (captions + steps)
│       ├── captions.ts             # proportional per-sentence/per-step captions
│       ├── audioSource.ts          # clip -> staticFile()/URL resolution
│       ├── outputPath.ts           # never-overwrite output paths
│       ├── RenderInput.ts          # { plan, sources, options } contract
│       ├── highlight.ts            # Shiki (fine-grained bundle)
│       ├── theme.ts                # dark editor theme
│       ├── components/             # CodeFrame, SceneChrome, ChangeList, ...
│       ├── scenes/                 # code-walkthrough, diff, summary, architecture
│       └── fixtures/sampleInput.ts # deterministic fixture plan
├── tests/                          # node:test suite + temp-repo fixtures
├── .agents/plugins/marketplace.json# repo marketplace for local testing
├── docs/adr/0001-tooling-decisions.md
├── plan/                           # implementation plan
├── package.json
└── tsconfig.json
```

## Prerequisites

- Node.js `>= 22.18` (verified on v24.21.0) — runs `.ts` files directly, no build step.
- macOS 15+ for Remotion rendering (verified on macOS 26.6.2).
- `OPENAI_API_KEY` in the environment for narration (later phases only).

## Explain a branch

The explanations are **authored by the coding agent** running the `$explain-branch` skill (or by
you), so the workflow is scaffold → author → render.

```bash
npm install
npm run browser:ensure                 # one-time Chrome Headless Shell download
npm run plan -- --out artifacts/run/plan.scaffold.json   # 1. grouping + suggested steps
# 2. read the code and author artifacts/run/plan.json (schema v3; see the skill docs)
export OPENAI_API_KEY=sk-...           # required for narration; read from the environment only
npm run explain -- --plan artifacts/run/plan.json        # 3. narrate -> render -> validate
```

Step 2 is where the value is: for each scene the agent writes ordered `steps`, each highlighting
a few lines with a plain-English explanation of what those lines do (assuming the viewer may not
know the language), and sets `narrationText` to the steps joined. The script never writes
narration — without `--plan` it stops (exit `3`) rather than producing a mechanical script. The
skill ([`skills/explain-branch/SKILL.md`](skills/explain-branch/SKILL.md)) drives this end to end.

It writes only under `artifacts/` and never switches branches or edits tracked files.

Useful flags (full list in
[`skills/explain-branch/references/flags.md`](skills/explain-branch/references/flags.md)):

| Flag                     | Meaning                                               |
| ------------------------ | ----------------------------------------------------- |
| `--plan <path>`          | authored plan to narrate and render (required)        |
| `--base <ref>`           | comparison base (default: auto-resolved)              |
| `--include-working-tree` | include uncommitted changes                           |
| `--max-scenes <n>`       | total scenes incl. the summary (default 5)            |
| `--out <path>`           | output MP4 (default `artifacts/branch-explainer.mp4`) |
| `--dry-run`              | narration cost estimate only; no writes               |
| `--stdout`               | print the scaffold JSON and stop                      |
| `--overwrite`            | replace an existing output (default: timestamped)     |
| `--force`                | ignore the resume checkpoint                          |

Repository defaults can be set once in `.explain-branch.json` or `package.json`
(`explainBranch`): `base`, `maxScenes`, and a `narration` object.

### Outputs, exit codes, and resume

Everything for a run lives in `artifacts/<run-id>/`:

```text
artifacts/<run-id>/
  plan.json            # the authored plan, rewritten with narration audio metadata
  authored-plan.json   # checkpoint of the authored plan (enables resume without re-authoring)
  narration.txt        # narration script
  render-input.json    # props passed to the renderer
  report.json          # machine-readable run report
  audio/<scene>.wav    # one clip per scene
```

The MP4 defaults to `artifacts/branch-explainer.mp4`. stdout carries only the run report JSON;
progress and the human summary go to stderr.

**Exit codes:** `0` success · `2` base/config could not be resolved · `3` plan missing or failed
validation · `4` missing/rejected `OPENAI_API_KEY` · the renderer's exit code on render failure
· `1` other.

**Resume:** a valid `<run-id>/plan.json` is reused and cached clips are skipped, so a failed or
interrupted render can simply be re-run (`--force` regenerates everything). On failure the run
directory is kept and a resume command is printed. The run-directory and report schemas are in
[`skills/explain-branch/references/plan-schema.md`](skills/explain-branch/references/plan-schema.md).

### Limitations

- **TTS needs a key and network.** Without `OPENAI_API_KEY` the run stops before planning
  (exit `4`); it never renders a silent video in its place.
- **Large branches may be summarised.** The scaffold prioritises the most consequential changes
  and lists what it omitted in the plan/report — the agent does not narrate every file.
- **Diagrams are optional** and currently minimal; they never invent components absent from the
  inspected code.
- **Read-only by design.** No branch switching, commits, or writes to tracked files; output
  goes under `artifacts/` (or `--out`).
- **Code is shown from a snapshot.** Line references are validated against the captured
  snapshot so highlights cannot silently drift.

## Inspect a branch

```bash
npm install
npm run inspect -- --base main      # human-readable summary (read-only)
npm run inspect -- --json           # full structured inventory
npm run inspect -- --include-working-tree
npm test                            # run the test suite
npm run typecheck
```

Base precedence: `--base` > `.explain-branch.json` / `package.json` > upstream > `main`|`master`.
When the choice is ambiguous the CLI exits `2` with guidance. Everything runs through a
read-only Git runner: no checkout/reset/stash/commit, `--no-ext-diff`/`--no-textconv` so
repository-configured programs never execute, and writes are confined to `artifacts/`.

## Build a scene scaffold

```bash
npm run plan                    # writes artifacts/plan.scaffold.json
npm run plan -- --stdout        # print the scaffold instead of writing
npm run plan -- --max-scenes 3
```

The scaffold groups related files into logical scenes (not one scene per file), ranks them,
and suggests walkthrough steps with **blank narration**, matching `src/planning/types.ts` (v3).
Every referenced file and line range is verified against a read-only source snapshot
(`src/analysis/validatePlan.ts`); generated files become omissions and honest caveats are
attached. The scaffold is deterministic for a given inventory and timestamp. The host agent then
reads the code and authors the narration/steps to produce `plan.json`.

## Render a video

```bash
npm run browser:ensure              # one-time Chrome Headless Shell download
npm run render:fixture              # artifacts/render-fixture.mp4 (silent, ~32s)
npm run studio                      # interactive preview
```

The Remotion composition (`src/render/index.ts`, id `ExplainBranch`) receives a fully
serializable `{ plan, sources, options }` input, so the video shows real captured code and
never touches the repository while rendering. Code scenes are syntax-highlighted with Shiki
(fine-grained bundle, JavaScript engine — no wasm fetch). A scene with `steps` advances through
the change a few lines at a time: the discussed code stays vertically centred, an arrow in the
gutter marks the line being explained, the frame punches in slightly for a short highlight, and
the code slides between steps as the narration plays. Scenes ease in and out with a restrained
fade/slide/scale so pages transition rather than cut. There are no on-screen captions: the
narration alone carries the explanation, so the code keeps the full frame. Deletions render as
diff summaries; the closing scene summarises the branch, its omissions, and caveats.

## Narrate a video

The scaffold → author → render flow above runs all of this; the stage CLIs below remain
available for advanced or manual use.

```bash
export OPENAI_API_KEY=sk-...          # required; read from the environment only
npm run narrate                       # writes artifacts/<branch>/plan.json + audio clips
npm run narrate -- --dry-run          # scenes, character counts, estimated cost (no API calls)
npm run narrate -- --scene scene-2    # regenerate a single clip
npm run narrate -- --force            # regenerate every clip
npm run render:narrated -- --plan artifacts/<run>/plan.json
```

`npm run narrate` generates one audio clip per scene, measures each clip's real duration, and
writes a plan whose scene lengths are driven by that audio. Clips are cached, so re-running
skips unchanged scenes and a failed render resumes without re-billing. Missing or rejected
credentials stop with a clear message and a non-zero exit.

`npm run render:narrated` assembles the full Remotion props (`{ plan, sources, options }`) by
capturing the source files the plan references, writes them to `<plan-dir>/render-input.json`,
and renders with the repository root as the public dir so audio clips resolve. It never
overwrites an existing MP4 unless you pass `--overwrite`.

See [`docs/manual-smoke-test.md`](docs/manual-smoke-test.md) for the manual, real-API smoke
test (not part of `npm test`).

### Privacy and AI-voice disclosure

- **What is sent:** the narration text for each scene (derived from the diff) is transmitted to
  the configured TTS provider (OpenAI by default). Nothing else is uploaded.
- **Secret redaction:** a pre-flight filter replaces secret-looking values (API keys, tokens,
  `.env`-style assignments, private keys, credentials in URLs) with `[REDACTED:…]` markers
  before they can become narration; what was filtered is reported to stderr.
- **API keys:** `OPENAI_API_KEY` is read from the environment only and is never written to the
  plan, logs, captions, or video.
- **AI voice:** narration is synthetic. Per OpenAI's usage policy, the voice you hear is
  **AI-generated, not a human voice**.

## Run the placeholder skeleton

```bash
npm run hello -- --demo     # prints a JSON report and exits 0
```

The placeholder reports the Node version, working directory, plugin env vars, arguments,
and stdin size — enough to confirm how Codex invokes local scripts.

## Test in Codex (manual)

The plugin is authored to the documented Agent Plugins / Codex conventions but has **not**
been exercised in a live Codex client (none is installed here). To verify:

1. Install the Remotion-independent prerequisites above.
2. Make this a Git repo and open it in Codex / the ChatGPT desktop app
   (`git init` is recommended, though not required by Phase 0).
3. Use the repo marketplace at `.agents/plugins/marketplace.json` (or
   `codex plugin marketplace add .`) to expose the plugin.
4. Enter `$explain-branch` and confirm the skill activates and runs
   `src/cli/explainBranchVideo.ts` (see open items in the ADR). Confirm the exact trigger
   token and the argv/cwd contract while you are there.

## Roadmap

| Phase        | Deliverable                                |
| ------------ | ------------------------------------------ |
| **0 (done)** | ADR + invocable plugin skeleton            |
| **1 (done)** | Tested branch-inspection CLI (read-only)   |
| **2 (done)** | Validated scene plan JSON                  |
| **3 (done)** | Silent video renderer + Shiki highlighting |
| **4 (done)** | Narration + synchronization                |
| **5 (done)** | End-to-end integration via the skill       |
| 6            | Quality, robustness, docs                  |
