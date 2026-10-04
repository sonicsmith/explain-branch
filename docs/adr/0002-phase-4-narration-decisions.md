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

## Decisions pending

Recorded here as their tasks are implemented:

- §2 — clip format, on-disk layout, plan path recording, cache key.
- §3 — duration source of truth, rounding rule, lead-in/tail/gap defaults.
- §4 — audio asset resolution strategy, caption timing approach.
- §5 — retry policy, TTS concurrency limit, overwrite rule.
- §6 — what is transmitted, and the redaction rules applied first.
- §7 — how the TTS provider is abstracted so tests need no network.
