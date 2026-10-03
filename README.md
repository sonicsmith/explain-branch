# explain-branch

A Codex plugin/skill that analyses the current Git branch and produces a **narrated
explainer video** showing what changed, how the changed code works, and how it fits the
wider application.

> **Status: Phase 2 — branch inspection and scene planning implemented.** Narration and
> rendering are not built yet. See [`plan/overview.md`](plan/overview.md) for the phased plan
> and [`docs/adr/0001-tooling-decisions.md`](docs/adr/0001-tooling-decisions.md) for the
> verified tooling decisions.

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
│   │   ├── types.ts                # versioned scene-plan schema
│   │   ├── paths.ts                # path-safety checks
│   │   └── buildPlan.ts            # deterministic planner
│   └── cli/
│       ├── explainBranch.ts        # Phase 1 inspection CLI
│       └── planBranch.ts           # Phase 2 planning CLI
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

## Inspect a branch

```bash
npm install
npm run inspect -- --base main      # human-readable summary (read-only)
npm run inspect -- --json           # full structured inventory
npm run inspect -- --include-working-tree
npm test                            # 43 tests
npm run typecheck
```

Base precedence: `--base` > `.explain-branch.json` / `package.json` > upstream > `main`|`master`.
When the choice is ambiguous the CLI exits `2` with guidance. Everything runs through a
read-only Git runner: no checkout/reset/stash/commit, `--no-ext-diff`/`--no-textconv` so
repository-configured programs never execute, and writes are confined to `artifacts/`.

## Build a scene plan

```bash
npm run plan                    # writes artifacts/branch-plan.json
npm run plan -- --stdout        # print the plan instead of writing
npm run plan -- --max-scenes 3
```

The planner groups related files into logical scenes (not one scene per file), ranks them,
and emits a versioned JSON plan matching `src/planning/types.ts`. Every referenced file and
line range is verified against a read-only source snapshot before the plan is accepted
(`src/analysis/validatePlan.ts`); generated files become omissions and honest caveats are
attached. The plan is deterministic for a given inventory and timestamp.

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
4. Enter `$explain-branch` and confirm the skill activates and the placeholder script
   runs (see open items in the ADR).

## Roadmap

| Phase        | Deliverable                              |
| ------------ | ---------------------------------------- |
| **0 (done)** | ADR + invocable plugin skeleton          |
| **1 (done)** | Tested branch-inspection CLI (read-only) |
| **2 (done)** | Validated scene plan JSON                |
| 3            | Serviceable silent video renderer        |
| 4            | Narration + synchronization              |
| 5            | End-to-end integration via the skill     |
| 6            | Quality, robustness, docs                |
