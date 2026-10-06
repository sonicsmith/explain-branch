# ADR 0006 — The CLI authors the narration (in-script LLM authoring)

- **Status:** Accepted
- **Date:** 2026-10-06
- **Phase:** post-migration follow-up (revises [ADR 0005](0005-drop-plugin-packaging.md))
- **Related:** [ADR 0004](0004-agent-authored-explanations.md),
  [ADR 0002](0002-phase-4-narration-decisions.md), [`docs/cli.md`](../cli.md),
  [`skills/explain-branch/SKILL.md`](../../skills/explain-branch/SKILL.md)

## Context

Phase 6 (ADR 0004) made explanations **agent-authored**: a host coding agent read the code and
wrote the narration, and the script only rendered it. ADR 0005 then dropped the plugin/skill
surface and moved authoring to the **user**, which made a single-command workflow impossible:
`explain` required a hand-written `--plan`, and the AI-authored experience the skill provided
was gone.

In practice the tool's value is the narration, and asking the user to write it by hand defeats
the purpose. ADR 0005 explicitly flagged this for revisit ("add an in-script LLM authoring step
… revisit in a follow-up ADR").

## Decision

**The CLI authors the narration itself by calling a chat model.** `explain-branch explain` now
runs: scaffold → **author** → narrate → render → validate.

- New `src/authoring/` module:
  - `config.ts` — model resolution (`--author-model` > `.explain-branch.json`
    `authoring.model` > `package.json` `explainBranch.authoring.model` >
    `EXPLAIN_BRANCH_AUTHOR_MODEL` > default `gpt-4o-mini`).
  - `provider.ts` — `AuthorProvider` interface (request carries the scaffold scenes, the changed
    files, and the source excerpts; the response is one authored scene per request scene).
  - `openaiAuthorProvider.ts` — the SDK entry point; Chat Completions with a **strict JSON
    schema** response format, and the same secret redaction as narration applied to the source
    excerpts it sends.
  - `fakeAuthorProvider.ts` — deterministic offline provider for tests.
  - `authorPlan.ts` — builds the request from the scaffold and merges the returned text back.
- **Structural fields are frozen by the scaffold.** The model may only supply a scene title,
  purpose, one narration per walkthrough step, and the summary narration. Scene ids, visuals,
  `sourceLocations`, step line ranges, and `changes` are preserved verbatim, so an authored plan
  always validates against the same source as its scaffold — the model cannot move a highlight.
- **Fail loudly.** A missing scene, a step-count mismatch, or empty narration throws
  `AuthorError` (exit `1`) instead of rendering a half-empty plan.
- `--plan <plan.json>` still bypasses authoring and uses a hand-authored plan. A `--dry-run`
  requires `--plan` (authoring is skipped on dry runs). `--stdout` still prints the bare
  scaffold.
- Restore `skills/explain-branch/SKILL.md` as the agent-facing entry point that drives the CLI.

`runAuthor` joins the other stages in `src/pipeline/stages.ts`, so the orchestrator and the
standalone CLIs share one implementation. The authoring SDK is imported lazily, so
inspect/scaffold paths never load `openai`.

## Consequences

- One command produces a narrated video: `npm run explain`.
- Privacy surface grows: the **redacted** source excerpts for the referenced lines are sent to
  the authoring chat model, in addition to narration text being sent to TTS. Documented in the
  README, `docs/cli.md`, and the skill.
- A new failure mode (malformed or mismatched model output) exists, mitigated by structured
  outputs plus strict merge validation.
- An extra chat call per run (cost); roughly one call per plan, not per scene.
- `EXPLAIN_BRANCH_TEST_FAKE_AUTHOR=1` keeps the end-to-end tests offline.

## Alternatives considered

- **Keep manual authoring only (ADR 0005).** Rejected: it removed the AI-authored behaviour the
  tool exists to provide and forced a multi-step workflow.
- **Restore the full plugin/skill packaging and rely on a host agent.** Rejected: reintroduces
  ADR 0005's manifest/marketplace maintenance burden. A repo-local skill plus the in-script
  authorer covers the agent case without the packaging.
- **Generate mechanical narration as a fallback.** Rejected, unchanged from ADR 0004: a video
  that looks narrated but explains nothing is worse than a clear failure.
