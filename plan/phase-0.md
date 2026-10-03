# Phase 0 — Verify Tooling

> Source: [`overview.md`](./overview.md) §13 (Phase 0) and §16 (First task).
> **Goal:** De-risk the design by confirming the real plugin, runtime, rendering, and TTS
> workflows *before* writing pipeline code. No product features are built in this phase.
> **Deliverable:** A short architecture decision record (ADR) plus a minimal, invocable plugin skeleton.

## Objective

Verify the assumptions the whole plan depends on. Every item below must be answered from
current official documentation or a real local experiment — **not** from memory or out-of-date
examples. Record evidence (links, versions, commands, outputs) as you go.

---

## 1. Codex plugin & skill format

- [ ] Read the current official plugin docs: <https://developers.openai.com/plugins/build/plugins>
- [ ] Confirm the required manifest filename(s), location, and fields.
- [ ] Confirm the skill/instructions entry-point convention (folder layout, instruction file name).
- [ ] Confirm how a user invokes the skill (e.g. `/explain-branch`) and how arguments are passed.
- [ ] Confirm what hooks/commands a plugin may expose and whether local executables are allowed.
- [ ] Record the **exact** plugin entry point and invocation mechanism.

**Decision to record:** exact plugin entry point + invocation mechanism.

## 2. TypeScript / script execution

- [ ] Determine how the plugin runs local code (Node script? bundled binary? shell command?).
- [ ] Confirm the available Node.js runtime version in the target environment.
- [ ] Decide the TypeScript execution strategy (tsc build → node, tsx/ts-node, bundler, etc.).
- [ ] Confirm how arguments and stdin/stdout are passed between Codex and the script.
- [ ] Identify any sandboxing / working-directory / permission constraints.

**Decision to record:** how TypeScript code will be executed + required Node.js/system dependencies.

## 3. Remotion rendering workflow

- [ ] Check the current official Remotion installation instructions for a TS project.
- [ ] Confirm current stable Remotion + React versions and pin compatible versions.
- [ ] Confirm the CLI/renderer invocation (`remotion render`, bundler, entry point) and its requirements.
- [ ] Identify system dependencies for video/audio (FFmpeg, Chrome/Chromium headless, fonts).
- [ ] Verify how to render a short MP4 locally on macOS.

**Decision to record:** how the renderer will run in the target environment + system dependencies.

## 4. Narration / TTS provider

- [ ] Confirm the TTS provider (default: OpenAI TTS) and the current API endpoint/model.
- [ ] Confirm required credentials, how they are supplied (env var), and how absence is detected.
- [ ] Confirm supported output audio formats and how to read clip duration.
- [ ] Confirm rate limits and error/retry behavior to design around.
- [ ] Confirm what repository content is transmitted to the service (privacy note).
- [ ] Verify a short sample narration clip end-to-end with a real key (or document the exact steps).

**Decision to record:** how narration is generated and authenticated + privacy/data-transmission notes.

## 5. Environment & outputs

- [ ] Document platform/runtime constraints (macOS, Node version, disk, GPU/headless needs).
- [ ] Decide where outputs live (`artifacts/branch-explainer.mp4`) and the no-overwrite policy.
- [ ] Decide where intermediate plan/audio artifacts are kept so failed renders are retryable.
- [ ] Confirm `.gitignore` handling for `artifacts/` and temp files.

**Decision to record:** how outputs and temporary files will be managed.

---

## Deliverables

1. **Architecture decision record (ADR)** — a concise note covering all five "Decision to record"
   items above, with evidence (doc links, versions, commands, observed outputs).
2. **Minimal plugin skeleton** — the smallest structure that Codex can actually invoke, able to
   run a placeholder TypeScript script and print output. It does **not** need any branch-analysis
   logic yet.

## Exit criteria

- [ ] Every question in sections 1–5 is answered with current, cited evidence.
- [ ] The ADR is written in the repo.
- [ ] The plugin skeleton is invoked from Codex and runs the placeholder script successfully.
- [ ] No assumptions remain about manifest structure, runtime, renderer, or TTS that were not verified.

## Handoff to Phase 1

Once the skeleton is invocable, proceed to **Phase 1 only**: a tested TypeScript branch-inspection
CLI that identifies the current branch, safely resolves the comparison base, inventories changed
files and diff hunks, and never modifies the repository.
