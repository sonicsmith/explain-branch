/**
 * Narration configuration surface (Phase 4 §1).
 *
 * This module intentionally has **no** OpenAI SDK import so the config and credential
 * layers can be unit-tested offline. The facts encoded here were re-verified against the
 * live OpenAI docs on 2026-10-04 — see
 * `docs/adr/0002-phase-4-narration-decisions.md` (Decision 1).
 */

/** Output formats accepted by `POST /v1/audio/speech`, in OpenAI's documented order. */
export const SUPPORTED_SPEECH_FORMATS = [
  "mp3",
  "opus",
  "aac",
  "flac",
  "wav",
  "pcm",
] as const;

export type SpeechFormat = (typeof SUPPORTED_SPEECH_FORMATS)[number];

export const SUPPORTED_PROVIDERS = ["openai"] as const;
export type NarrationProvider = (typeof SUPPORTED_PROVIDERS)[number];

export interface NarrationConfig {
  provider: NarrationProvider;
  /** OpenAI TTS model id, e.g. `gpt-4o-mini-tts`. */
  model: string;
  /** Built-in voice name, e.g. `marin`. */
  voice: string;
  /**
   * Optional tone/style instructions. Only honoured by `gpt-4o-mini-tts`; other models
   * reject them, so the resolver drops the default but errors on an explicit choice.
   */
  instructions?: string;
  /** Audio container/codec requested from the provider. `wav` is preferred. */
  format: SpeechFormat;
}

export const DEFAULT_NARRATION_CONFIG: NarrationConfig = {
  provider: "openai",
  model: "gpt-4o-mini-tts",
  voice: "marin",
  instructions:
    "Speak clearly and evenly, like a developer walking a teammate through code.",
  format: "wav",
};

/** Voices supported by `gpt-4o-mini-tts` (all 13 built-ins). */
const GPT_4O_MINI_TTS_VOICES: readonly string[] = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
];

/** Voices supported by the older `tts-1` / `tts-1-hd` models (a strict subset). */
const TTS_1_VOICES: readonly string[] = [
  "alloy",
  "ash",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
];

/** Voice support per known model. Unknown model ids are not constrained. */
export const VOICES_BY_MODEL: Readonly<Record<string, readonly string[]>> = {
  "gpt-4o-mini-tts": GPT_4O_MINI_TTS_VOICES,
  "gpt-4o-mini-tts-2025-12-15": GPT_4O_MINI_TTS_VOICES,
  "tts-1": TTS_1_VOICES,
  "tts-1-hd": TTS_1_VOICES,
};

/**
 * Returns the voices the given model supports, or `null` when the model is unknown (in
 * which case voice validation is skipped rather than guessing).
 */
export function supportedVoicesForModel(
  model: string,
): readonly string[] | null {
  return VOICES_BY_MODEL[model] ?? null;
}

/** `instructions` (tone) works only with `gpt-4o-mini-tts`; it is ignored elsewhere. */
export function modelSupportsInstructions(model: string): boolean {
  const known = supportedVoicesForModel(model);
  if (known === null) return true; // Unknown model: don't block a possibly-valid choice.
  return model !== "tts-1" && model !== "tts-1-hd";
}

/**
 * Validates a fully-resolved narration config. Returns human-readable problems (empty when
 * valid) so callers can fail loudly before any network call is made.
 */
export function validateNarrationConfig(config: NarrationConfig): string[] {
  const errors: string[] = [];
  const provider = config.provider as string;

  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(provider)) {
    errors.push(
      `Unsupported narration provider "${provider}". Supported providers: ${SUPPORTED_PROVIDERS.join(", ")}.`,
    );
  }

  if (typeof config.model !== "string" || config.model.trim() === "") {
    errors.push("narration model must be a non-empty string.");
  }

  const voices = supportedVoicesForModel(config.model);
  if (voices !== null && !voices.includes(config.voice)) {
    errors.push(
      `Voice "${config.voice}" is not supported by model "${config.model}". Supported voices: ${voices.join(", ")}.`,
    );
  }

  if (
    !(SUPPORTED_SPEECH_FORMATS as readonly string[]).includes(config.format)
  ) {
    errors.push(
      `Unsupported audio format "${config.format}". Supported formats: ${SUPPORTED_SPEECH_FORMATS.join(", ")}.`,
    );
  }

  if (
    config.instructions !== undefined &&
    config.instructions.trim() !== "" &&
    !modelSupportsInstructions(config.model)
  ) {
    errors.push(
      `Model "${config.model}" does not support "instructions"; use gpt-4o-mini-tts or remove the instructions setting.`,
    );
  }

  return errors;
}
