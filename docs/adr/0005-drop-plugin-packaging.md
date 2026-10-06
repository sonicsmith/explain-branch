# ADR 0005 — Drop the plugin packaging; ship a standalone CLI

- **Status:** Accepted
- **Date:** 2026-10-06
- **Phase:** migration (post-Phase 6)
- **Supersedes:** [ADR 0001](0001-tooling-decisions.md) Decision 1 (plugin entry point and
  invocation mechanism)
- **Related:** [`docs/migration-to-cli.md`](../migration-to-cli.md)

## Context

`explain-branch` was built as a portable Agent Plugins package: a root `plugin.json`, a
`.codex-plugin/plugin.json` compatibility overlay, a repo marketplace
(`.agents/plugins/marketplace.json`), and a `skills/explain-branch/SKILL.md` skill whose
workflow assumed a host coding agent (Codex/ChatGPT) would scaffold, read the code, and author
the plan before invoking the CLI (Phase 6 / ADR 0004).

That packaging exists only to be _discovered and driven by a host agent_. Nothing in the
pipeline needs it, and it carries real cost: two manifests to keep in sync, a marketplace file,
`PLUGIN_ROOT`/`PLUGIN_DATA` conventions threaded through `src/pipeline/stages.ts` and the docs,
an agent-authored workflow that is meaningless without a host agent, and unverifiable open items
(invocation token, marketplace root, script cwd contract) that could not be tested locally.

The project's actual value is the deterministic pipeline plus the renderer, which are plain
Node/TypeScript and have no host dependency.

## Decision

**Remove the plugin/skill surface and expose a single command-line entry point.**

- Delete `plugin.json`, `.codex-plugin/`, `.agents/` (marketplace), and `skills/` (including the
  Phase 0 `hello.ts` probe). The reference docs move to `docs/flags.md` and
  `docs/plan-schema.md`; the skill's workflow becomes `docs/cli.md`.
- Add `bin/explain-branch.ts` as the one supported entry point: a thin dispatcher over the stage
  CLIs (`inspect`, `plan`, `narrate`, `render`, `explain`), each of which stays independently
  runnable. A subcommand runs in its own `node` process so exit codes and stdio pass through
  unchanged. `package.json` gains a `bin` field; scripts delegate to it.
- Rename `PLUGIN_ROOT` → `PROJECT_ROOT` and remove all skill/host-agent references from source
  comments and user-facing help text.
- **Authoring model:** narration is authored **by the user**, not a host agent. The scaffold →
  author → render flow is unchanged; only who authors changes. (Calling a chat model from the
  script was considered and rejected for now — see below.)
- ADR 0001 Decision 1, ADR 0003 Decision 6, and ADR 0004 are marked historical rather than
  rewritten; they remain an accurate record of the plugin era.

## Consequences

- The repository is a plain local Node project: `npm install`, author a plan, run a command. No
  Codex/ChatGPT surface, no marketplace, no manifests to sync.
- The CLI is directly testable and documentable; the unverifiable "invoked from Codex" open
  items disappear.
- The authoring step is now manual (or driven by whatever tool the user prefers), so the
  scaffold output quality and `docs/cli.md` matter more.
- Distribution is unchanged in spirit: private, local, not published to npm.

## Alternatives considered

- **Keep both surfaces (plugin + CLI).** Rejected: the plugin surface was the source of the
  maintenance burden, and the CLI already covered the pipeline.
- **Add an in-script LLM authoring step** (`--author`) to replace the host agent. Deferred, not
  rejected: it would reuse the existing `openai` dependency and `OPENAI_API_KEY`, but adds
  prompts, cost, and a second failure mode. Revisit in a follow-up ADR if manual authoring
  proves too heavy.
- **Generate mechanical narration as a fallback.** Rejected, unchanged from ADR 0004: a video
  that looks narrated but explains nothing is worse than a clear failure (exit `3`).
