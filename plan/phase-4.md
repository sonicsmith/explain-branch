# Phase 4 — Narration and Synchronization

> Source: [`overview.md`](./overview.md) §10 (Audio & timing), §13 (Phase 4), §8 (scene plan
> model), §15 (engineering principles) and [`../docs/adr/0001-tooling-decisions.md`](../docs/adr/0001-tooling-decisions.md)
> (Decision 4 — narration, Decision 5 — outputs).
> **Goal:** Turn the silent, fixed-length renderer from Phase 3 into a narrated video whose
> scene lengths are driven by the **real duration of each generated audio clip**.
> **Deliverable:** A short, synchronized, narrated MP4 plus the per-scene audio clips and an
> updated plan recording each clip's path and duration.

## Objective

Phase 3 renders a deterministic silent MP4 from a fixture plan, using a fixed
`secondsPerScene` for every scene. Phase 4 replaces that fixed timing with real narration:

- generate one audio clip per scene from `scene.narrationText`,
- measure each clip's true duration,
- derive every scene's frame length from that duration plus a configurable lead-in/tail,
- play the clips in the composition so speech and visuals stay in sync,
- validate the result and fail loudly (never silently) when narration is unavailable.

**Current state to build on (already implemented):**

- `ExplainerScene.narrationText`, `narrationAudioPath`, `narrationDurationMs` already exist in
  `src/planning/types.ts` (schema v2).
- `validatePlan(plan, { snapshot, requireNarrationAudio: true })` already enforces that every
  scene has audio path + positive duration — wire it into the narrate path.
- `RenderInput` (`src/render/RenderInput.ts`) has `plan`, `sources`, `options`; timing is
  currently `options.secondsPerScene` with `sceneDurationInFrames()` / `totalDurationInFrames()`.
- Phase 0 decisions: OpenAI Speech API, `gpt-4o-mini-tts`, `OPENAI_API_KEY`, prefer `wav`,
  per-scene clips, retry 429/5xx, documented privacy.

---

## 1. TTS provider, model, and credentials

- [x] Re-read the current OpenAI text-to-speech docs and confirm the endpoint, model id,
      voice list, and supported `response_format` values (do not rely on Phase 0's snapshot).
      → recorded in [`../docs/adr/0002-phase-4-narration-decisions.md`](../docs/adr/0002-phase-4-narration-decisions.md) (Decision 1).
- [x] Confirm the default model (`gpt-4o-mini-tts`) and default voice; confirm which voices
      the configured model actually supports.
      → `VOICES_BY_MODEL` in [`../src/narration/types.ts`](../src/narration/types.ts); ADR 0002 (Decision 1).
- [x] Reuse the already-installed `openai` SDK; confirm the current `audio.speech.create`
      signature and streaming/non-streaming behavior.
      → verified `openai@7.27.0`: `create()` returns `APIPromise<Response>`, non-streaming by default; ADR 0002 (Decision 1).
- [x] Decide the configuration surface and precedence (CLI flag > project config
      `.explain-branch.json` / `package.json` > environment default), covering: provider,
      model, voice, instructions (tone), and output format.
      → [`../src/narration/config.ts`](../src/narration/config.ts); ADR 0002 (Decision 1).
- [x] Credential handling: read `OPENAI_API_KEY` from the environment only. If it is missing
      or rejected, **stop with a clear setup message** and do **not** claim narration is
      available. Never read keys from the repo, never write them to logs, the plan, or the video.
      → [`../src/narration/credentials.ts`](../src/narration/credentials.ts); ADR 0002 (Decision 1).
- [x] Confirm current rate limits and any per-request character limits; record what the retry
      design must tolerate. Confirm current pricing so cost notes are accurate.
      → [`../src/narration/limits.ts`](../src/narration/limits.ts); ADR 0002 (Decision 1).

**Decision to record:** provider/model/voice defaults, configuration precedence, and the exact
missing-credential behavior.

## 2. Audio generation pipeline

- [x] Add a narration stage (suggested `src/narration/`) that takes a validated plan and
      returns the plan with `narrationAudioPath` + `narrationDurationMs` filled in.
      → [`../src/narration/narratePlan.ts`](../src/narration/narratePlan.ts).
- [x] Generate **one clip per scene** (per §10) so retries and re-renders are cheap and
      independent.
      → sequential per-scene generation in `narratePlan`; ADR 0002 (Decision 2).
- [x] Store clips under the run directory: `artifacts/<run-id>/audio/<scene-id>.wav`
      (aligns with ADR Decision 5). Decide how the path is recorded in the plan — recommend
      relative to the repository root so the plan stays portable and the renderer can resolve it.
      → `<run-dir>/audio/<scene-id>.<format>`; path recorded repo-relative POSIX; ADR 0002 (Decision 2).
- [x] Make generation **idempotent and cache-aware**: skip a scene when an identical clip
      already exists (hash of text + model + voice + instructions + format), so a failed render
      never re-bills for audio it already has.
      → SHA-256 cache key + per-clip sidecar in [`../src/narration/narratePlan.ts`](../src/narration/narratePlan.ts); ADR 0002 (Decision 2).
- [x] Add `--dry-run` that reports the scenes, character counts, and estimated cost without
      calling the API.
      → `--dry-run` in [`../src/cli/narrateBranch.ts`](../src/cli/narrateBranch.ts); [`../src/narration/estimate.ts`](../src/narration/estimate.ts).
- [x] Add a `--scene <id>` / `--force` affordance to regenerate a single clip.
      → `--scene` / `--force` in [`../src/cli/narrateBranch.ts`](../src/cli/narrateBranch.ts).

**Decision to record:** clip format, on-disk layout, how the path is recorded in the plan, and
the cache key.

## 3. Duration measurement and the timeline model

- [x] Measure each clip's duration and store it as `narrationDurationMs` (integer ms).
      → [`../src/narration/narratePlan.ts`](../src/narration/narratePlan.ts) (rounded to integer ms).
- [x] Prefer reading the **WAV header** (no dependency, no decode); fall back to FFprobe for
      other formats. Confirm Remotion's bundled FFprobe is available for that fallback
      (`node_modules/.remotion`), and decide whether to use `@remotion/renderer`'s helper or a
      direct `ffprobe` invocation.
      → [`../src/narration/duration.ts`](../src/narration/duration.ts); Remotion's bundled FFprobe via `RenderInternals.callFf`; ADR 0002 (Decision 3).
- [x] Define the timeline: `sceneMs = leadInMs + narrationDurationMs + tailMs`, with a
      configurable minimum scene length and an optional inter-scene gap. Convert to frames
      consistently (one rounding rule) so total duration is exact.
      → [`../src/render/timeline.ts`](../src/render/timeline.ts); ADR 0002 (Decision 3).
- [x] Decide the rounding policy and assert that `sum(sceneFrames) === durationInFrames` and
      that no narration is cut off (scene length ≥ clip length + tail).
      → `ceil` per scene; `assertTimelineConsistent` in [`../src/render/timeline.ts`](../src/render/timeline.ts); ADR 0002 (Decision 3).
- [x] Update the renderer's timing so per-scene length comes from `narrationDurationMs` when
      present, falling back to `options.secondsPerScene` for silent/un-narrated scenes.
      → `buildRenderTimeline` in [`../src/render/RenderInput.ts`](../src/render/RenderInput.ts); used by [`../src/render/ExplainerVideo.tsx`](../src/render/ExplainerVideo.tsx).
- [x] Keep `calculateMetadata` authoritative for `durationInFrames`, `fps`, and dimensions so
      `--props` renders match the timeline.
      → [`../src/render/Root.tsx`](../src/render/Root.tsx) (via `totalDurationInFrames(props)`).

**Decision to record:** duration source of truth, rounding rule, and the lead-in/tail/gap
defaults.

## 4. Renderer changes (playback, timing, captions)

- [x] Play each scene's clip with Remotion's `<Audio>` inside its `<Sequence>`, resolving the
      path (recommend `staticFile()` for bundled assets, or an absolute/file URL for
      run-directory clips — decide and document which).
      → `staticFile()` + `--public-dir=<repo-root>` in [`../src/render/audioSource.ts`](../src/render/audioSource.ts) / [`../src/render/SceneRenderer.tsx`](../src/render/SceneRenderer.tsx); ADR 0002 (Decision 4).
- [x] Verify how props and assets reach the renderer: confirm whether audio files must be
      bundled (`--public-dir` / `staticFile`) or can be referenced by absolute path when
      rendering locally, and confirm behavior with `--props=<file>`.
      → confirmed: Remotion runs in the browser, absolute paths unsupported; clips are served via `--public-dir`; ADR 0002 (Decision 4).
- [x] Drive per-scene `durationInFrames` from the measured duration; add a configurable visual
      lead-in so the code scroll/highlight finishes before or during the first words.
      → `narrationStartFrame` lead-in in [`../src/render/timeline.ts`](../src/render/timeline.ts); audio offset in [`../src/render/SceneRenderer.tsx`](../src/render/SceneRenderer.tsx).
- [x] Align captions with the audio: OpenAI TTS does not return word/segment timings, so decide
      between (a) proportional per-sentence chunks using the clip duration, or (b) showing the
      full line for the scene duration. Record the trade-off; prefer (a) if it stays honest.
      → option (a) in [`../src/render/captions.ts`](../src/render/captions.ts); ADR 0002 (Decision 4).
- [x] Confirm audio level consistency across scenes (§9) and that no scene cuts speech off.
      → uniform `volume={1}`; timeline guarantees scene ≥ clip + tail; ADR 0002 (Decision 4).
- [x] Keep the composition deterministic and re-runnable from stored plan + clips.
      → composition reads only plan + sources + options (no `fs`); ADR 0002 (Decision 4).

**Decision to record:** audio asset resolution strategy and the caption timing approach.

## 5. Validation and failure handling

- [x] Run `validatePlan(plan, { snapshot, requireNarrationAudio: true })` in the narrate path
      and fail with a non-zero exit code when a scene lacks audio.
      → [`../src/narration/validateNarration.ts`](../src/narration/validateNarration.ts) wired into [`../src/cli/narrateBranch.ts`](../src/cli/narrateBranch.ts) (exit 3); ADR 0002 (Decision 5).
- [x] Validate at the audio layer too: clip exists, is non-empty, decodes, and its measured
      duration matches the recorded `narrationDurationMs` within a tolerance.
      → `validateNarratedPlan` (tolerance 100 ms); ADR 0002 (Decision 5).
- [x] Implement retries with exponential backoff + jitter for 429/5xx and network errors; cap
      attempts; **do not retry** 4xx that are not rate-limit related (bad request, auth).
      → [`../src/narration/retry.ts`](../src/narration/retry.ts) (`withRetry`) used in `narratePlan`; OpenAI SDK retries disabled (`maxRetries: 0`); ADR 0002 (Decision 5).
- [x] Make failures recoverable: keep the plan and any already-generated clips so a retry
      resumes rather than restarting.
      → per-scene clip + sidecar writes; cache-aware re-runs; CLI reports kept clips; ADR 0002 (Decision 5).
- [x] Ensure the final MP4 is written without silently overwriting an existing output
      (timestamped name or explicit confirmation, per §2/§15).
      → [`../src/render/outputPath.ts`](../src/render/outputPath.ts) (`resolveOutputPath`) + `--overwrite=false` in `npm run render:narrated`; ADR 0002 (Decision 5).

**Decision to record:** retry policy, concurrency limit for TTS calls, and the overwrite rule.

## 6. Privacy and secrets

- [x] Document plainly that narration text (derived from repository content) is transmitted to
      the configured TTS provider.
      → README "Privacy and AI-voice disclosure"; runtime notice + `--help` note in [`../src/cli/narrateBranch.ts`](../src/cli/narrateBranch.ts); ADR 0002 (Decision 6).
- [x] Add a pre-flight filter that skips/redacts secret-looking values (keys, tokens, `.env`
      content) before they can become narration text, and report what was filtered.
      → [`../src/narration/redact.ts`](../src/narration/redact.ts) (`redactPlanNarration`), wired into the narrate CLI; ADR 0002 (Decision 6).
- [x] Confirm API keys never reach the scene plan, the logs, the rendered video, or captions.
      → `OPENAI_API_KEY` used only to build the SDK client; `redactSecret()` for safe logging; audited; ADR 0002 (Decision 6).
- [x] Note the AI-voice disclosure requirement in the README.
      → README "Privacy and AI-voice disclosure"; ADR 0002 (Decision 6).

**Decision to record:** what is transmitted, and the redaction rules applied first.

## 7. Testing

- [x] Unit-test the WAV duration parser against known headers (including odd chunk sizes).
      → [`../tests/narration/wav.test.ts`](../tests/narration/wav.test.ts) (round-trip, odd chunk + padding, non-WAV).
- [x] Unit-test the timeline math: lead-in/tail/gap, rounding, minimum length, and that
      `sum(sceneFrames)` equals `durationInFrames`.
      → [`../tests/render/timeline.test.ts`](../tests/render/timeline.test.ts).
- [x] Test the retry/backoff policy with a fault-injecting fake client (no network).
      → [`../tests/narration/retry.test.ts`](../tests/narration/retry.test.ts); ADR 0002 (Decision 7).
- [x] Test the missing-credential path asserts a clear message and a non-zero exit.
      → [`../tests/cli/narrateBranch.test.ts`](../tests/cli/narrateBranch.test.ts) (exit 4); dry run exits 0.
- [x] Add a **fake TTS provider** so the whole narrate → plan → timeline path is tested
      deterministically offline; use real recorded silence in place of clips.
      → [`../src/narration/fakeSpeechProvider.ts`](../src/narration/fakeSpeechProvider.ts) + [`../tests/narration/pipeline.test.ts`](../tests/narration/pipeline.test.ts); ADR 0002 (Decision 7).
- [x] Keep the existing `requireNarrationAudio` validator tests; extend them for the new checks.
      → `requireNarrationAudio` duration cases in [`../tests/analysis/validatePlan.test.ts`](../tests/analysis/validatePlan.test.ts) + audio-layer [`../tests/narration/validateNarration.test.ts`](../tests/narration/validateNarration.test.ts).
- [x] Add a manual smoke test: one real narrated render of the fixture (requires
      `OPENAI_API_KEY` and network) — documented as manual, not part of `npm test`.
      → [`../docs/manual-smoke-test.md`](../docs/manual-smoke-test.md); ADR 0002 (Decision 7).

**Decision to record:** how the TTS provider is abstracted so tests need no network.

---

## Deliverables

1. A narration stage (`src/narration/`) that generates per-scene clips, measures durations, and
   returns the plan enriched with `narrationAudioPath` + `narrationDurationMs`.
2. Audio-driven scene timing in the renderer (playback + per-scene duration + captions), with a
   documented fallback to `secondsPerScene` when narration is absent.
3. A narrate CLI entry point (for example `npm run narrate`) with `--dry-run`, cache/force
   behavior, and actionable errors.
4. An updated, validated plan JSON recording each scene's audio path and duration.
5. Tests covering duration parsing, timeline math, retries, credential handling, and the
   offline fake-provider path.
6. A short **synchronized, narrated MP4** rendered from the fixture.

## Exit criteria

- [ ] Narration clips exist for every scene and their durations are recorded in the plan.
- [ ] Each scene is at least as long as its clip; no narration is cut off; captions advance with
      the audio.
- [ ] `sum(sceneFrames)` equals the composition's `durationInFrames`, and the rendered MP4's
      duration matches within one frame.
- [ ] Missing credentials produce a clear setup message and a non-zero exit — never a silent or
      falsely-narrated render.
- [ ] Retries handle rate-limit and transient errors; a failed render can be retried without
      regenerating existing clips.
- [ ] API keys never appear in the plan, logs, captions, or video.
- [ ] `npm test` and `npm run typecheck` pass; the narrated render is a valid playable MP4.

## Handoff to Phase 5

Once a narrated fixture render works end to end, proceed to **Phase 5 only**: wire the real
pipeline together — Git inspection → planning → narration → rendering → validation — behind the
`$explain-branch` skill, with progress reporting, actionable errors, and output artifacts that
never overwrite existing files.
