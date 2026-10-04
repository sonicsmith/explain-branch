# ADR 0002 — Phase 4: Narration and Synchronization Decisions

- **Status:** In progress (decisions recorded as each Phase 4 task lands)
- **Date:** 2026-10-04
- **Phase:** 4 (Narration and synchronization) — see [`plan/phase-4.md`](../../plan/phase-4.md)
- **Scope:** Records the decisions Phase 4 requires. Phase 0's
  [`ADR 0001`](./0001-tooling-decisions.md) (Decision 4) fixed the provider at a high level;
  this ADR re-verifies the provider against the **current** docs and records the remaining
  Phase 4 decisions as they are implemented.

## Context

Phase 0 chose OpenAI for narration but explicitly warned not to rely on its snapshot for
implementation details. All facts below were re-checked against the live OpenAI docs on
**2026-10-04**, not from memory:

- Text to speech guide — <https://developers.openai.com/api/docs/guides/text-to-speech>
- Create speech API reference —
  <https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create>
- Pricing — <https://developers.openai.com/api/docs/pricing>
- Rate limits — <https://developers.openai.com/api/docs/guides/rate-limits>

---

## Decision 1 — TTS provider, model, voice, format, and credential behavior

**Decision.** Use the **OpenAI Speech API** through the official `openai` Node SDK, and
adopt the following defaults and behavior.

### Endpoint and call shape

- HTTP: `POST https://api.openai.com/v1/audio/speech`.
- SDK: `client.audio.speech.create({ model, voice, input, response_format, instructions, speed, stream_format })`.
- Verified locally against the installed SDK: **`openai@7.27.0`**
  (`node_modules/openai/resources/audio/speech.d.ts`). There,
  `Audio.Speech.create(body, options?)` returns `APIPromise<Response>` — a fetch `Response`.
  Read the audio with `await response.arrayBuffer()` (or `.blob()`); the SDK buffers the full
  file by default.
- Streaming is opt-in: pass `stream_format: "sse"` (server-sent audio events) or `"audio"`
  (chunked audio). The default non-streaming call returns the complete file, which is what the
  per-scene clip pipeline uses. `stream_format: "sse"` is unsupported on `tts-1` / `tts-1-hd`.
- `speed` accepts `0.25`–`4.0` (default `1.0`); `instructions` is optional.

### Model

- Default: **`gpt-4o-mini-tts`** (confirmed as the newest/most reliable TTS model, controllable
  via `instructions`).
- Available models: `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`, `gpt-4o-mini-tts-2025-12-15`.
- `instructions` (tone control) works **only** with `gpt-4o-mini-tts`; it is ignored/rejected by
  `tts-1` / `tts-1-hd`. `stream_format: "sse"` is likewise unsupported on `tts-1` / `tts-1-hd`.

### Voice

- Default: **`marin`** (OpenAI recommends `marin` or `cedar` for best quality).
- All 13 built-in voices (supported by `gpt-4o-mini-tts`): `alloy`, `ash`, `ballad`, `coral`,
  `echo`, `fable`, `nova`, `onyx`, `sage`, `shimmer`, `verse`, `marin`, `cedar`.
- The `tts-1` / `tts-1-hd` models support a **smaller** set only: `alloy`, `ash`, `coral`, `echo`,
  `fable`, `onyx`, `nova`, `sage`, `shimmer`. Config that pairs a restricted voice with those
  models must be rejected up front rather than failing at the API.
- Custom voices exist but are out of scope; the voice field also accepts a `{ id }` object.

### Response format

- Supported: `mp3` (default), `opus`, `aac`, `flac`, `wav`, `pcm`.
- **Prefer `wav`** for per-scene clips: uncompressed, low-latency, and its header yields the
  duration without decoding — matching Phase 3's plan to read durations from the file header.

### Request limits

- `input` maximum length is **4096 characters**. The narration stage must split/limit per scene
  and fail loudly (not truncate silently) when a scene's narration exceeds this.

### Configuration surface and precedence

- Precedence (highest first): **CLI flag → `.explain-branch.json` (`narration`) →
  `package.json` (`explainBranch.narration`) → environment → built-in default**.
- Environment layer: optional `EXPLAIN_BRANCH_TTS_PROVIDER` / `_MODEL` / `_VOICE` /
  `_INSTRUCTIONS` / `_FORMAT` variables, overridden by project config.
- Configurable: provider, model, voice, `instructions` (tone), output format.
- Defaults: provider `openai`, model `gpt-4o-mini-tts`, voice `marin`, format `wav`.
- Implemented in `src/narration/config.ts` (`resolveNarrationConfig`); the resolved config is
  validated for model/voice/format/instructions compatibility before any API call.

### Credentials and missing-credential behavior

- Read `OPENAI_API_KEY` **from the environment only**; never from the repo, and never write it to
  logs, the plan, the video, or captions.
- If the key is **missing or rejected (401/403)**: stop with a clear setup message and a
  **non-zero exit code**, and do **not** claim narration is available. Never fall back to a silent
  render that implies narration succeeded.
- Implemented in `src/narration/credentials.ts` (`readOpenAiApiKey`, `MissingCredentialError`,
  `CredentialRejectedError`, `redactSecret`).

### Retry / rate-limit facts the retry design must tolerate

- Rate limits are enforced at the **organization and project** level and vary by model; there is no
  static per-tier RPM/TPM table to hard-code. Read live values from the response headers
  (`x-ratelimit-*`) and the account limits page.
- Temporary throttling: **`429`** with error code `slow_down`; model overload: **`503`** with
  `server_is_overloaded`. Both may carry a `Retry-After` header, which is a **minimum** wait — add
  jitter on top.
- Official SDKs already retry eligible `429`/`503` responses. Application-level retries must
  **disable SDK retries or account for them** so nested loops don't multiply requests.
- Never retry quota, billing, auth, or other action-required errors; only transient/rate-limit
  failures.

### Pricing (for cost notes and `--dry-run` estimates)

- `gpt-4o-mini-tts`: **text input $0.60 / 1M tokens**, **audio output $12.00 / 1M tokens**.
- `tts-1`: $15.00 / 1M characters; `tts-1-hd`: $30.00 / 1M characters.
- Recorded as constants in `src/narration/limits.ts`, alongside the 4096-character request
  limit and the retryable-status helpers (`isRetryableStatus`, `retryAfterMs`).

### Privacy and disclosure

- Narration text is derived from repository content and **is transmitted to OpenAI**. Document
  this to the user and redact secret-looking values before narration.
- OpenAI's usage policy requires a **clear disclosure that the voice is AI-generated**; the
  README must carry this notice.

**Consequences.**

- The narration stage targets one provider/endpoint with a small, validated config surface.
- Voice/model compatibility is validated before any API call.
- The 4096-character limit forces explicit handling of long scenes in the narration stage.
- The retry layer depends on runtime signals (headers/status), so it is designed around a
  fault-injecting fake client rather than hard-coded limits.

**Open items (to be resolved by later Phase 4 tasks).** Exact SDK retry defaults for the
installed `openai@7.27.0` (the signature is confirmed above; its retry/backoff settings are
not), and whether to disable them in favour of the app-level policy (§5).

---

## Decision 2 — Audio generation pipeline (clip format, layout, cache)

**Decision.**

- **One clip per scene**, so retries and re-renders are cheap and independent (plan §10).
- **Format:** the resolved `config.format` (default `wav`); the clip extension follows it.
  WAV is required for now because duration is read from the RIFF header; other formats are
  rejected with a clear message until the FFprobe fallback lands (§3).
- **On-disk layout:** `<run-dir>/audio/<sanitized-scene-id>.<format>` plus a sidecar
  `<clip>.json` holding
  `{ cacheKey, sceneId, format, model, voice, characters, durationMs, generatedAt }`. The
  default run dir is `artifacts/<run-id>/audio`, where `<run-id>` defaults to the sanitized
  branch name so re-runs reuse clips.
- **Path recorded in the plan:** repository-relative POSIX (for example
  `artifacts/<run-id>/audio/scene-1.wav`), so the plan stays portable and the renderer resolves
  it against the repository root.
- **Cache key:** `sha256(JSON.stringify({ provider, model, voice, instructions: string | null,
format, text }))`. A scene is skipped when the sidecar's key matches and the clip exists and
  is non-empty; `--force` (or naming a scene with `--scene`) bypasses this.
- **Idempotent and resumable:** clips and sidecars are written per scene, so a later failure
  leaves earlier clips in place and a retry resumes rather than restarting.
- **Fail loudly:** a scene whose narration exceeds the 4096-character request limit aborts
  with a clear message (never truncated); an empty provider response is an error.
- **Sequential generation** for now; the TTS concurrency limit is decided in §5.

**Implemented in** `src/narration/narratePlan.ts`, with the provider abstraction in
`provider.ts` / `openaiSpeechProvider.ts`, the offline `fakeSpeechProvider.ts`, the WAV reader
in `wav.ts`, and cost/`--dry-run` estimation in `estimate.ts`. The CLI entry point is
`src/cli/narrateBranch.ts` (`npm run narrate`).

**Consequences.**

- Re-running `npm run narrate` is cheap: matching clips are reused and never re-billed.
- The plan points at clips by relative path, so the plan and run directory can move together.
- Non-WAV formats are temporarily unusable until §3 adds FFprobe duration measurement.

---

## Decision 3 — Duration measurement and the timeline model

**Decision.**

- **Duration source of truth:** each scene's `narrationDurationMs` (integer ms), written by the
  narration stage. Silent scenes have no value and fall back to `secondsPerScene`.
- **Measurement:** WAV is read directly from the RIFF header (no dependency, no decode). Non-WAV
  clips fall back to FFprobe via Remotion's bundled binary
  (`RenderInternals.callFf({ bin: "ffprobe", ... })`, auto-downloaded into
  `node_modules/.remotion`). The runner is imported dynamically so the WAV path never pulls in
  `@remotion/renderer`; the deprecated `getVideoMetadata` helper is avoided.
- **Timeline:** `sceneMs = leadInMs + narrationDurationMs + tailMs`, plus `gapMs` for scenes after
  the first, clamped to `minSceneMs`. Silent scenes use `secondsPerScene`.
- **Rounding rule (a single rule):** `frames = max(1, ceil(sceneMs / 1000 × fps))`, applied per
  scene. `ceil` guarantees no truncation, and `durationInFrames` is the **sum** of the scene
  frames, so `sum(sceneFrames) === durationInFrames` holds exactly.
- **Gap:** folded into the length of scenes after the first, so the sum identity holds without a
  separate gap element.
- **Defaults:** `leadInMs = 500`, `tailMs = 750`, `gapMs = 250`, `minSceneMs = 2000`.
- **Assertion:** `buildTimeline` asserts the sum identity and that every narrated scene lasts at
  least its narration plus the tail, throwing on violation.
- **Renderer wiring:** `RenderInput` exposes `resolveTimelineOptions` / `buildRenderTimeline`;
  both `totalDurationInFrames` and `ExplainerVideo` use it, and `calculateMetadata` stays
  authoritative for `durationInFrames`, `fps`, and dimensions so `--props` renders match.

**Implemented in** `src/render/timeline.ts`, `src/narration/duration.ts`, and
`src/render/RenderInput.ts`.

**Consequences.** The fixture (no narration) still renders 32 s at 30 fps, while narrated plans
now get per-scene lengths derived from real audio. Non-WAV formats work, but need Remotion's
FFprobe to be downloadable on first use.

---

## Decision 4 — Audio playback, captions, and asset resolution

**Decision.**

- **Asset resolution:** Remotion runs in the browser and cannot read arbitrary files off disk,
  so clips are served through the public directory. The composition references each scene's clip
  with `staticFile(scene.narrationAudioPath)`, and renders pass the **repository root** as
  `--public-dir`. Because §2 records paths repository-relative
  (`artifacts/<run-id>/audio/<scene-id>.wav`), that path is exactly the `staticFile()` argument.
  `resolveAudioSrc()` also accepts an `options.audioBaseUrl` override for hosted/SSR renders
  (`<base>/<path>`), carried through `--props=<file>` when present. Absolute paths are not
  supported by Remotion and are not used.
- **Playback:** each scene's clip plays with Remotion's `<Audio>` inside the scene `<Sequence>`,
  wrapped in an inner `<Sequence from={narrationStartFrame}>` so speech begins after the
  configurable visual lead-in. `volume` is fixed at `1` for every scene (single provider/voice),
  so loudness is consistent; no scene cuts speech off because the timeline guarantees the scene
  is at least the clip plus the tail.
- **Captions:** OpenAI TTS returns no word or segment timings, so captions are chunked **by
  sentence** with the measured clip duration distributed across sentences **proportionally to
  character count** (option (a)). This tracks the audio approximately and honestly; scenes with
  no measured narration fall back to option (b) — the whole line for the scene duration.
- **Determinism:** the composition reads only `plan` + `sources` + options (no `fs`), so a render
  is reproducible from the stored plan and clips.

**Implemented in** `src/render/audioSource.ts`, `src/render/captions.ts`,
`src/render/SceneRenderer.tsx`, and `src/render/components/SceneChrome.tsx`; the per-scene
narration offset comes from `src/render/timeline.ts` (`narrationStartFrame`).

**Render note.** The composition consumes a full `RenderInput` (`{ plan, sources, options }`),
not a bare plan — Remotion shallow-merges `defaultProps`, so passing a plan alone silently falls
back to the fixture. `src/cli/renderBranch.ts` (`npm run render:narrated`) captures the plan's
source files, writes `<plan-dir>/render-input.json`, and renders with the repository root as the
public dir, e.g.
`npm run render:narrated -- --plan artifacts/<run>/plan.json`.

**Consequences.** The plan and run directory are self-contained, but a render must be told the
public dir (the default `public/` will not resolve clips). Caption timing is an approximation,
labelled as such, rather than exact word alignment.

---

## Decision 5 — Retry policy, concurrency, validation, and the overwrite rule

**Decision.**

- **Retry policy:** transient failures only — HTTP 429 and 5xx, plus network errors
  (`TypeError`, `APIConnectionError`, `ECONNRESET`, …). Exponential backoff with jitter:
  `maxAttempts 4`, `initialDelayMs 500`, `factor 2`, `maxDelayMs 20000`, `jitter 0.25`.
  `Retry-After`, when present, is treated as a **minimum** wait. Non-retryable client errors
  (400, 401/403, 404, …) and credential failures surface immediately. The OpenAI SDK's own
  retries are disabled (`maxRetries: 0`) so the two loops cannot multiply requests.
- **Concurrency:** TTS calls are **sequential** (concurrency 1). A plan has few scenes and
  per-scene clips already make retries independent; sequential keeps progress, ordering, and
  rate-limit behaviour predictable. Revisit if scene counts grow.
- **Recoverability:** clips and sidecars are written per scene, so a failure keeps completed
  clips and a re-run resumes from cache without regenerating (or re-billing for) them.
- **Overwrite rule:** outputs are never overwritten silently. `resolveOutputPath()` returns the
  desired path when free, or a `<name>-<UTC timestamp>[-n]<ext>` sibling when it exists, unless
  the caller opts in with `overwrite: true`. Remotion renders also pass `--overwrite=false`, so a
  render fails loudly rather than clobbering a previous MP4.
- **Validation:** the narrate path runs
  `validatePlan(plan, { snapshot, requireNarrationAudio: true })` plus audio-layer checks — each
  clip exists, is non-empty, decodes, and its measured duration is within
  `DEFAULT_DURATION_TOLERANCE_MS = 100` ms of the recorded value — and exits non-zero on failure.

**Implemented in** `src/narration/retry.ts`, `src/narration/validateNarration.ts`, and
`src/render/outputPath.ts`; wired through `src/narration/narratePlan.ts` and
`src/cli/narrateBranch.ts` (`npm run narrate`, `npm run render:narrated`).

**Consequences.** Failed renders recover cheaply; rate limiting cannot double-retry; a second
render never clobbers the first without an explicit flag.

---

## Decision 6 — Privacy and secret redaction

**Decision.**

- **What is transmitted:** only the per-scene narration text (derived from the diff) is sent to
  the configured TTS provider (OpenAI by default). Source files, the plan, and credentials are
  not uploaded beyond the narration currently being spoken.
- **Pre-flight redaction:** `redactPlanNarration()` runs before narration (and before the plan
  is written or rendered), replacing secret-looking values with `[REDACTED:<kind>]` markers and
  reporting what was filtered. Rules, specific before generic: OpenAI keys (`sk-…`), GitHub
  tokens (`ghp_…`/`github_pat_…`), Slack tokens (`xox…-`), AWS access keys (`AKIA…`), Google API
  keys (`AIza…`), `Bearer` tokens, PEM private-key blocks, URLs with embedded credentials,
  `*KEY|TOKEN|SECRET|PASSWORD|…=value` assignments, and long high-entropy runs (≥ 32 chars
  containing a digit). Redaction is conservative — over-redaction beats leaking a credential.
- **API keys never persist:** `OPENAI_API_KEY` is read from the environment only, used solely to
  construct the SDK client, and never written to the plan, logs, captions, video, or sidecars.
  `redactSecret()` exists for safe logging.
- **AI-voice disclosure:** the README states that narration is AI-generated, per OpenAI's usage
  policy.

**Implemented in** `src/narration/redact.ts` (wired into `src/cli/narrateBranch.ts`) and the
README's "Privacy and AI-voice disclosure" section.

**Consequences.** Redaction can alter narration wording when the high-entropy rule trips; the
report makes that visible. It is a safety net, not a guarantee — code frames still show raw
repository content.

---

## Decision 7 — Test strategy for narration (offline by default)

**Decision.**

- The TTS provider is abstracted behind the `SpeechProvider` interface
  (`src/narration/provider.ts`). The only implementation that imports the `openai` SDK is
  `openaiSpeechProvider.ts`; the narration stage depends on the interface, not the SDK.
- Tests use `FakeSpeechProvider` (`src/narration/fakeSpeechProvider.ts`), which records each
  request and returns **real silence WAV** built by `createSilenceWav()`, so the full
  narrate → plan → timeline path runs deterministically with no network and no credentials
  (`tests/narration/pipeline.test.ts`).
- FFprobe is likewise injected (`measureDuration` / `ffprobe`), so duration tests never spawn a
  process.
- The missing-credential path is covered at the CLI boundary by spawning
  `src/cli/narrateBranch.ts` with `OPENAI_API_KEY` unset and asserting exit code `4` plus a clear
  message (`tests/cli/narrateBranch.test.ts`).
- The one test that needs the real API is the manual smoke test in
  `docs/manual-smoke-test.md`, explicitly excluded from `npm test`.

**Existing coverage.** WAV parser (`tests/narration/wav.test.ts`), timeline math
(`tests/render/timeline.test.ts`), retry/backoff with a fault-injecting provider
(`tests/narration/retry.test.ts`), credential handling (`tests/narration/credentials.test.ts`),
redaction (`tests/narration/redact.test.ts`), audio-layer validation
(`tests/narration/validateNarration.test.ts`), output naming
(`tests/render/outputPath.test.ts`), captions/assets (`tests/render/captions.test.ts`,
`tests/render/audioSource.test.ts`), and the extended `requireNarrationAudio` checks
(`tests/analysis/validatePlan.test.ts`).

**Consequences.** `npm test` is fully offline and hermetic; only the manual smoke test touches
the network.

---

## Decisions pending

All Phase 4 decisions are recorded above.
