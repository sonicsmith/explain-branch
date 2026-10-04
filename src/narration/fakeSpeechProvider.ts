/**
 * Deterministic, offline {@link SpeechProvider} for tests. It records each request and
 * returns real (silent) WAV bytes, so duration parsing and the whole narrate →
 * plan → timeline path can be exercised without the network or credentials.
 */
import type { SpeechProvider, SpeechSynthesisRequest } from "./provider.ts";
import { createSilenceWav } from "./wav.ts";

export interface FakeSpeechProviderOptions {
  /** Duration in ms for a request; defaults to a deterministic function of the text. */
  durationMs?: (request: SpeechSynthesisRequest) => number;
}

/** Deterministic clip length so tests can assert exact durations. */
export function defaultFakeDurationMs(request: SpeechSynthesisRequest): number {
  return 1000 + Math.min(30000, request.text.length * 50);
}

export class FakeSpeechProvider implements SpeechProvider {
  readonly requests: SpeechSynthesisRequest[] = [];

  constructor(private readonly options: FakeSpeechProviderOptions = {}) {}

  async synthesize(request: SpeechSynthesisRequest): Promise<Uint8Array> {
    this.requests.push(request);
    const durationMs =
      this.options.durationMs?.(request) ?? defaultFakeDurationMs(request);
    return createSilenceWav(durationMs);
  }
}
