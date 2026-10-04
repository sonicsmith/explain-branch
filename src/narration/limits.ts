/**
 * Confirmed provider limits and pricing for narration (Phase 4 §1).
 *
 * Values re-verified against the live OpenAI docs on 2026-10-04 — see
 * `docs/adr/0002-phase-4-narration-decisions.md` (Decision 1). Kept dependency-free so cost
 * notes and `--dry-run` estimates never require the SDK or the network.
 */

/** Maximum number of characters accepted by `POST /v1/audio/speech` in one request. */
export const MAX_SPEECH_INPUT_CHARACTERS = 4096;

/** Number of characters in `text`, counted by Unicode code point (matches the API unit). */
export function countSpeechCharacters(text: string): number {
  return Array.from(text).length;
}

/** Pricing model shape: token-metered (gpt-4o-mini-tts) or per-character (tts-1 family). */
export type SpeechPricing =
  | {
      kind: "tokens";
      /** USD per 1M input (narration text) tokens. */
      textInputPerMillionTokens: number;
      /** USD per 1M audio output tokens. */
      audioOutputPerMillionTokens: number;
    }
  | {
      kind: "characters";
      /** USD per 1M input characters. */
      perMillionCharacters: number;
    };

/** Confirmed standard pricing, keyed by model id. */
export const SPEECH_PRICING: Readonly<Record<string, SpeechPricing>> = {
  "gpt-4o-mini-tts": {
    kind: "tokens",
    textInputPerMillionTokens: 0.6,
    audioOutputPerMillionTokens: 12.0,
  },
  "gpt-4o-mini-tts-2025-12-15": {
    kind: "tokens",
    textInputPerMillionTokens: 0.6,
    audioOutputPerMillionTokens: 12.0,
  },
  "tts-1": { kind: "characters", perMillionCharacters: 15.0 },
  "tts-1-hd": { kind: "characters", perMillionCharacters: 30.0 },
};

export function pricingForModel(model: string): SpeechPricing | null {
  return SPEECH_PRICING[model] ?? null;
}

/** HTTP 429 — temporary throttle (`slow_down`); retryable, honouring `Retry-After`. */
export const RATE_LIMIT_STATUS = 429;

/**
 * True for failures the retry policy should attempt again: rate limiting (429) and server
 * errors (5xx, including overload 503). Client errors (other 4xx: auth, bad request) are
 * not retryable and must surface immediately.
 */
export function isRetryableStatus(status: number): boolean {
  return status === RATE_LIMIT_STATUS || (status >= 500 && status <= 599);
}

/** Extracts a `Retry-After` delay in milliseconds when a valid header value is present. */
export function retryAfterMs(
  headers: { get(name: string): string | null } | undefined,
): number | null {
  const raw = headers?.get("retry-after");
  if (raw === undefined || raw === null) return null;
  const seconds = Number(raw.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds * 1000);
}
