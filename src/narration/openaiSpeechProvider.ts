/**
 * OpenAI-backed {@link SpeechProvider} (Phase 4 §1–§2). This is the only module that
 * imports the `openai` SDK, so the rest of the narration code stays offline-testable.
 *
 * Uses a non-streaming call: `audio.speech.create` returns the complete file, which we read
 * via `arrayBuffer()` (verified against `openai@7.27.0` — see ADR 0002, Decision 1).
 */
import OpenAI from "openai";
import { describeCredentialFailure } from "./credentials.ts";
import type { SpeechProvider, SpeechSynthesisRequest } from "./provider.ts";

export interface OpenAiSpeechProviderOptions {
  /** Read from the environment by the caller via `readOpenAiApiKey`. */
  apiKey?: string;
  /** Inject a pre-configured client (used by tests). */
  client?: OpenAI;
}

export function createOpenAiSpeechProvider(
  options: OpenAiSpeechProviderOptions,
): SpeechProvider {
  const client = options.client ?? new OpenAI({ apiKey: options.apiKey });

  return {
    async synthesize(request: SpeechSynthesisRequest): Promise<Uint8Array> {
      try {
        const response = await client.audio.speech.create({
          model: request.model,
          voice: request.voice,
          input: request.text,
          response_format: request.format,
          ...(request.instructions !== undefined &&
          request.instructions.trim() !== ""
            ? { instructions: request.instructions }
            : {}),
        });
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        throw describeCredentialFailure(error);
      }
    },
  };
}
