# Migration Plan — from Codex plugin to a standalone CLI

- **Status:** Proposed
- **Date:** 2026-10-06
- **Owner:** (you)
- **Related:** [`adr/0001-tooling-decisions.md`](adr/0001-tooling-decisions.md) (Decision 1, plugin
  packaging), [`adr/0004-agent-authored-explanations.md`](adr/0004-agent-authored-explanations.md)

## Goal

Turn `explain-branch` into a **plain local Node project** whose only interface is its own
command-line entry point. No plugin manifest, no marketplace, no skill discovery, no host agent
invocation (`$explain-branch`). A developer installs it, runs a command, and gets an MP4.

## Non-goals

- Rewriting the pipeline. Git inspection, planning, narration, rendering, and reporting stay.
- Dropping Remotion. It is still the renderer; it just stops being "plugin support code".
- Publishing to npm. `private: true` stays; the project remains a local tool.

## Why

The plugin packaging exists to be _discovered and driven by a host coding agent_. Nothing in the
core pipeline needs it, and the packaging adds real cost:

- Portable `plugin.json` + `.codex-plugin/plugin.json` compatibility overlay to keep in sync.
- A repo marketplace at `.agents/plugins/marketplace.json`.
- `${PLUGIN_ROOT}`/`PLUGIN_DATA` conventions threaded through `src/pipeline/stages.ts`, the skill
  docs, and the invocation contract.
- An **agent-authored** narration workflow (Phase 6) that only makes sense when a host agent is
  authoring the plan. On the command line there is no host agent, so this is the crux of the
  migration (see [Decision needed](#decision-needed-narration-authoring)).
- Docs (README, ADRs, `SKILL.md`) written around "run this from Codex", plus unverifiable open
  items (invocation token, marketplace root) that disappear once the plugin surface is gone.

## What changes at a glance

| Remove / retire                                          | Keep / repurpose                                             | Add                                          |
| -------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| `plugin.json` (portable manifest)                        | `src/**` pipeline, renderer, narration                       | A single `bin/explain-branch.ts` entry point |
| `.codex-plugin/plugin.json`                              | `tests/**`                                                   | `bin` field in `package.json`                |
| `.agents/plugins/marketplace.json` (+ `.agents/`)        | `package.json` scripts (trimmed)                             | `docs/cli.md` (flags, exit codes, schema)    |
| `skills/explain-branch/SKILL.md`                         | `references/flags.md`, `references/plan-schema.md` → `docs/` | CLI-authoring guide for `plan.json`          |
| `skills/explain-branch/scripts/hello.ts` (Phase 0 probe) | ADRs (mark superseded, don't delete)                         | ADR 0005 recording this migration            |
| `PLUGIN_ROOT` naming + `src/**` skill/agent refs         | `artifacts/` layout, run report                              |                                              |
| README "Run in Codex" sections                           | Privacy / requirements sections                              |                                              |

## Decision needed: narration authoring

Phase 6 made explanations **agent-authored**: the scaffold is deterministic, but a host coding
agent reads the changed code and writes the per-step narration. Command-line-only removes that
agent, so pick one before starting:

- **Option A — Manual authoring (recommended, simplest).** `plan --out plan.scaffold.json`
  produces grouping + step ranges with blank narration; the human edits it into `plan.json` and
  runs `explain --plan plan.json`. No new API surface, no new dependency, and it matches the
  "much simpler" goal. The current CLI already supports this fallback today.
- **Option B — Local LLM authoring step.** Add an opt-in `--author` mode that calls the OpenAI
  API (already a dependency, already authenticated by `OPENAI_API_KEY`) to draft narration from
  the inspected source, which the human reviews. More capable, but adds prompts, cost, a new
  failure mode, and a second reason the key is required.
- **Option C — Mechanical narration.** Auto-generate narration from the scaffold. Rejected: it
  is exactly the "unhelpful mechanical script" Phase 6 deliberately avoided.

> Default the plan below to **Option A**. Option B can be a follow-up ADR if manual authoring
> proves too heavy for daily use.

## Target layout

```
explain-branch/
  bin/
    explain-branch.ts        # single documented entry point (thin wrapper over src/)
  src/                       # unchanged pipeline (git, analysis, planning, narration, render, pipeline)
  tests/
  docs/
    cli.md                   # usage, flags, exit codes, plan schema
    plan-schema.md           # moved from skills/.../references/
    flags.md                 # moved from skills/.../references/
    adr/
    manual-smoke-test.md
    migration-to-cli.md      # this file
  artifacts/                 # gitignored run output
  package.json               # description, bin, scripts cleaned up
  tsconfig.json              # drop "skills" from include
  README.md
```

## Migration steps

### Phase 1 — Remove the plugin surface

- [ ] Delete `plugin.json`.
- [ ] Delete `.codex-plugin/` (whole directory).
- [ ] Delete `.agents/` (marketplace) — confirm nothing else references it first.
- [ ] Delete `skills/explain-branch/scripts/hello.ts` and the empty `scripts/` directory.
- [ ] Move `skills/explain-branch/references/flags.md` and `plan-schema.md` into `docs/`.
- [ ] Delete `skills/explain-branch/SKILL.md` (its content becomes `docs/cli.md`, see Phase 4).
- [ ] Remove the now-empty `skills/` tree.
- [ ] Drop `"skills"` from `tsconfig.json` `include`.

### Phase 2 — Make the CLI the primary interface

- [ ] Add `bin/explain-branch.ts` as the one supported entry point. It parses `argv` and
      dispatches to the existing subcommands (`plan`, `inspect`, `narrate`, `render`, `explain`)
      already implemented in `src/cli/*` and `src/pipeline/stages.ts`. Keep the subcommand
      modules; the new file is a thin, documented dispatcher (or fold them together if preferred).
- [ ] Add to `package.json`:
  ```json
  "bin": { "explain-branch": "bin/explain-branch.ts" }
  ```
- [ ] Rewrite `package.json` `description` (currently "Codex plugin that turns …") to describe a
      command-line tool.
- [ ] Trim `scripts`: drop `hello`; keep `inspect`/`plan`/`narrate`/`explain`/`render:*`/`studio`
      but have them delegate to `bin/explain-branch.ts`, keep `test`/`typecheck`/`browser:ensure`.
- [ ] Decide whether `--stdout` (scaffold JSON for an agent) stays. Under Option A it is still
      useful for piping, so keep it but re-document it as machine-readable output, not an agent
      hand-off.

### Phase 3 — Remove or rename plugin-specific identifiers

- [ ] In `src/pipeline/stages.ts`, rename `PLUGIN_ROOT` → `PROJECT_ROOT` (or `PACKAGE_ROOT`) and
      update the comment (currently "Plugin/repository root").
- [ ] Remove the skill/host-agent references from source comments and **user-facing help text**:
  - `src/cli/explainBranchVideo.ts:116` — the CLI `--help` output currently points the user at
    `skills/explain-branch/SKILL.md` and says "the host coding agent" authors narration. Repoint
    it at `docs/cli.md` and describe the chosen authoring path (see
    [Decision needed](#decision-needed-narration-authoring)), not a host agent.
  - `src/cli/planBranch.ts:8` — doc comment referencing `skills/explain-branch/SKILL.md` → `docs/cli.md`.
  - `src/planning/buildPlan.ts:345` — same.
  - `src/planning/types.ts:95` — same ("authored by the host coding agent").
- [ ] Grep the repo for `PLUGIN_ROOT`, `PLUGIN_DATA`, `CLAUDE_PLUGIN_ROOT`, `plugin.json`,
      `marketplace`, `Codex`, `host coding agent`, `skill` and update every remaining reference.
      This is the catch-all and must end up clean (verified in Phase 5).
- [ ] Keep the type-stripping-friendly style already in the codebase (no enums, no namespaces,
      no constructor parameter properties) — unchanged by this migration.

### Phase 4 — Rewrite docs around the CLI

- [ ] Rewrite `README.md`:
  - Remove "Run in Codex (primary path)" and "Run from the command line (fallback)".
  - Lead with the command-line quick start (`npm run plan` → author → `npm run explain`).
  - Keep Requirements, Privacy, and Outputs sections; drop plugin/marketplace/Codex text.
  - Add the chosen authoring path from [Decision needed](#decision-needed-narration-authoring).
- [ ] Create `docs/cli.md` from the current `SKILL.md`, reframed as a user manual: flags table,
      exit codes, stdout/stderr contract, run-directory layout, and the authoring walkthrough.
- [ ] Add an ADR (`docs/adr/0005-drop-plugin-packaging.md`) recording this decision and
      superseding ADR 0001 Decision 1. Mark 0001 Decision 1 as superseded rather than deleting it.
- [ ] Update `docs/manual-smoke-test.md` to drop any Codex steps.
- [ ] Update `docs/adr/0003-phase-5-integration-decisions.md` Decision 6 (skill/plugin wiring) to
      note it no longer applies.
- [ ] Decide the fate of the remaining historical ADR, `docs/adr/0004-agent-authored-explanations.md`
      (it states "The plugin/skill runs inside a coding agent (Codex/Claude)"). **Do not rewrite
      ADRs** — they are a historical record. Instead add a one-line "Historical — the plugin/skill
      surface was removed in ADR 0005; see `docs/cli.md`" note at the top of 0001 and 0004 so a
      reader is not misled.

### Phase 5 — Verify

- [ ] Run `npm run typecheck` and fix fallout from removing `skills/` from `tsconfig` and the
      `PLUGIN_ROOT` rename.
- [ ] Run `npm test`; fix any test that references plugin paths (e.g. `PLUGIN_ROOT`, `skills/`).
- [ ] Smoke test end to end with [Option A](#decision-needed-narration-authoring):
      `npm run plan -- --out artifacts/run/plan.scaffold.json`, hand-author `plan.json`, then
      `npm run explain -- --plan artifacts/run/plan.json`.
- [ ] Confirm `git status` is clean apart from the expected deletions/renames.
- [ ] Confirm no tracked file still references Codex/plugin/skill — the ADRs and this plan are the
      only allowed exceptions:
      `sh
    git grep -nEi "codex|plugin\.json|marketplace|host coding agent|skills/explain-branch" -- . \
      ':!docs/adr' ':!docs/migration-to-cli.md'
    `
      should return nothing.

## Risks and mitigations

- **Losing the authoring workflow.** The biggest behavioural change. Mitigate by documenting the
  manual authoring loop clearly (`docs/cli.md`) and keeping the scaffold output high quality.
- **Hidden plugin coupling.** Some code or test may rely on `PLUGIN_ROOT` or on being run from
  Codex's cwd. The grep in Phase 3 and the test run in Phase 5 catch this.
- **Doc drift.** ADRs are historical; mark them superseded rather than rewriting history, and put
  the new decision in its own ADR.

## Rollback

This is a deletion + rename migration on a private repo. If it goes wrong, `git revert` the
migration commits; no published artifact or external consumer depends on the plugin surface.
