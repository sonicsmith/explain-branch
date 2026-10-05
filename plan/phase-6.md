# Phase 6 — Explanation quality: agent-authored, multi-step walkthroughs

> Source: [`overview.md`](./overview.md) §7 (walkthrough quality and narration), §9 (video
> design), §14 (acceptance criteria) and
> [`../docs/adr/0004-agent-authored-explanations.md`](../docs/adr/0004-agent-authored-explanations.md).
> **Goal:** Make the explanation actually explain the code — authored by the host coding agent,
> walking through a few lines at a time — instead of mechanically narrating the diff.
> **Deliverable:** A scaffold → author → render workflow, multi-step scenes, and a video whose
> narration describes what the changed code does.

## Objective

Phase 5 shipped a full pipeline, but the narration was derived mechanically from the diff
(file counts, change types, symbol names) and each scene showed one static code block. This
phase replaces that with narration authored by the coding agent that runs the skill, and scenes
that advance through the code step by step.

**Decision (ADR 0004):** the host agent authors the plan and narration; the script only
scaffolds, narrates, renders, and validates.

## 1. Authoring model

- [x] Change the planner to a **scaffold** builder: deterministic grouping, source locations,
      and suggested steps, with narration left blank; never invent explanations.
      → `buildPlanScaffold` in [`../src/planning/buildPlan.ts`](../src/planning/buildPlan.ts).
- [x] `npm run plan` writes `artifacts/plan.scaffold.json` and documents the authoring step.
      → [`../src/cli/planBranch.ts`](../src/cli/planBranch.ts).
- [x] The orchestrator requires `--plan <path>` and exits `3` without one (no mechanical
      fallback); credentials are still pre-flighted first (exit `4`).
      → [`../src/cli/explainBranchVideo.ts`](../src/cli/explainBranchVideo.ts); ADR 0004.
- [x] Record the authored plan (`authored-plan.json`) and the narrated plan (`plan.json`).
      → orchestrator run directory.
- [x] Update the skill with the scaffold → author → render workflow and the narration quality
      bar. → [`../skills/explain-branch/SKILL.md`](../skills/explain-branch/SKILL.md).

## 2. Multi-step scenes

- [x] Schema v3: `ExplainerScene.steps?: SceneStep[]` (`{ narration, file, startLine,
    endLine }`). → [`../src/planning/types.ts`](../src/planning/types.ts).
- [x] Validate steps: non-empty narration (authored plans), file in the scene's
      sourceLocations, range inside that location, range within the snapshot; add
      `requireNarration`. → [`../src/analysis/validatePlan.ts`](../src/analysis/validatePlan.ts).
- [x] Renderer advances through steps: active-step highlight + scroll, transition replay at
      each step boundary. → [`../src/render/steps.ts`](../src/render/steps.ts),
      [`../src/render/scenes/CodeWalkthroughScene.tsx`](../src/render/scenes/CodeWalkthroughScene.tsx),
      [`../src/render/components/CodeFrame.tsx`](../src/render/components/CodeFrame.tsx).
- [x] One clip per scene, divided across steps proportionally to narration length; captions use
      the same windows. → [`../src/render/chunkTiming.ts`](../src/render/chunkTiming.ts),
      [`../src/render/captions.ts`](../src/render/captions.ts).

## 3. Privacy

- [x] Redact step narrations (captions) as well as `narrationText` before transmission.
      → [`../src/narration/redact.ts`](../src/narration/redact.ts); ADR 0004.

## 4. Tests

- [x] Scaffold tests: narration blank, suggested steps sit inside source locations,
      deterministic. → [`../tests/planning/buildPlan.test.ts`](../tests/planning/buildPlan.test.ts).
- [x] Orchestrator tests supply an authored plan via `--plan`.
      → [`../tests/pipeline/orchestrator.test.ts`](../tests/pipeline/orchestrator.test.ts).
- [x] Add focused tests for `distributeFrameWindows`, `buildStepWindows`/`activeStep`, and
      step-aware captions, and a `validatePlan` steps case.
      → [`../tests/render/steps.test.ts`](../tests/render/steps.test.ts) and steps cases in
      [`../tests/analysis/validatePlan.test.ts`](../tests/analysis/validatePlan.test.ts).

## 5. Docs

- [x] ADR 0004, SKILL.md, `references/plan-schema.md` (v3 + steps + authoring rules),
      `references/flags.md` (`--plan`). README to follow.

## Exit criteria

- [ ] `npm run explain -- --plan <plan.json>` renders a video whose narration explains the
      code, a few lines at a time, with highlights advancing as it plays.
- [ ] The script never produces mechanical narration; a missing authored plan fails with exit 3.
- [ ] `npm test` and `npm run typecheck` pass.
