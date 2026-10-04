/**
 * Cost estimation for narration (Phase 4 §2 `--dry-run`). Kept honest: character-priced
 * models can be estimated exactly, but token-priced models bill audio output that is unknown
 * until the clip is generated, so the estimate is flagged incomplete.
 */
import { pricingForModel } from "./limits.ts";

export interface CostEstimate {
  usd: number;
  /** Human-readable explanation of what the figure covers. */
  basis: string;
  /** `false` when the true cost depends on output that has not been generated yet. */
  complete: boolean;
}

/** Rough English token estimate; OpenAI bills TTS text input by token, not character. */
const CHARS_PER_TOKEN = 4;

export function estimateSpeechCost(
  model: string,
  characters: number,
): CostEstimate | null {
  const pricing = pricingForModel(model);
  if (pricing === null) return null;

  if (pricing.kind === "characters") {
    return {
      usd: (characters / 1_000_000) * pricing.perMillionCharacters,
      basis: "input characters",
      complete: true,
    };
  }

  const inputTokens = characters / CHARS_PER_TOKEN;
  return {
    usd: (inputTokens / 1_000_000) * pricing.textInputPerMillionTokens,
    basis:
      "text input tokens only (~4 chars/token); audio output is billed separately",
    complete: false,
  };
}
