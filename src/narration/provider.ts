/**
 * TTS provider abstraction (Phase 4 §2). Keeping the pipeline behind this interface means
 * the narrate stage can be tested offline with a fake provider, and the OpenAI SDK import
 * stays isolated in {@link ./openaiSpeechProvider.ts}.
 */
import type { SpeechFormat } from "./types.ts";

export interface SpeechSynthesisRequest {
  text: string;
  model: string;
  voice: string;
  instructions?: string;
  format: SpeechFormat;
}

/** A text-to-speech backend. Implementations return the encoded audio bytes. */
export interface SpeechProvider {
  synthesize(request: SpeechSynthesisRequest): Promise<Uint8Array>;
}

/** Raised for narration-pipeline failures that are not provider or credential errors. */
export class NarrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NarrationError";
  }
}
