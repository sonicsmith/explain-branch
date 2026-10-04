import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SPEECH_INPUT_CHARACTERS,
  countSpeechCharacters,
  isRetryableStatus,
  pricingForModel,
  retryAfterMs,
} from "../../src/narration/limits.ts";

test("counts speech characters by code point", () => {
  assert.equal(countSpeechCharacters("hello"), 5);
  // A surrogate pair counts as one character, matching the API's 4096-char limit.
  assert.equal(countSpeechCharacters("a😀b"), 3);
});

test("exposes the documented per-request character limit", () => {
  assert.equal(MAX_SPEECH_INPUT_CHARACTERS, 4096);
});

test("provides confirmed pricing per model", () => {
  const mini = pricingForModel("gpt-4o-mini-tts");
  assert.deepEqual(mini, {
    kind: "tokens",
    textInputPerMillionTokens: 0.6,
    audioOutputPerMillionTokens: 12,
  });
  assert.deepEqual(pricingForModel("tts-1"), {
    kind: "characters",
    perMillionCharacters: 15,
  });
  assert.deepEqual(pricingForModel("tts-1-hd"), {
    kind: "characters",
    perMillionCharacters: 30,
  });
  assert.equal(pricingForModel("unknown-model"), null);
});

test("retries only rate-limit and server errors", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(504), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(401), false);
  assert.equal(isRetryableStatus(404), false);
});

test("parses a valid Retry-After header into milliseconds", () => {
  const headers = {
    get: (name: string) => (name === "retry-after" ? "2" : null),
  };
  assert.equal(retryAfterMs(headers), 2000);

  const missing = { get: () => null };
  assert.equal(retryAfterMs(missing), null);
  assert.equal(retryAfterMs(undefined), null);

  const invalid = { get: () => "not-a-number" };
  assert.equal(retryAfterMs(invalid), null);
});
