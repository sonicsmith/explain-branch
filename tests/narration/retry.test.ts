import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CredentialRejectedError } from "../../src/narration/credentials.ts";
import { narratePlan } from "../../src/narration/narratePlan.ts";
import type { SpeechProvider } from "../../src/narration/provider.ts";
import {
  computeRetryDelayMs,
  isRetryableError,
  withRetry,
  type RetryPolicy,
} from "../../src/narration/retry.ts";
import { createSilenceWav } from "../../src/narration/wav.ts";
import { DEFAULT_NARRATION_CONFIG } from "../../src/narration/types.ts";
import type { ExplainerPlan } from "../../src/planning/types.ts";

const policy: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 1000,
  factor: 2,
  jitter: 0,
};

test("retries rate-limit and server errors only", () => {
  assert.equal(isRetryableError({ status: 429 }), true);
  assert.equal(isRetryableError({ status: 500 }), true);
  assert.equal(isRetryableError({ status: 503 }), true);
  assert.equal(isRetryableError({ status: 400 }), false);
  assert.equal(isRetryableError({ status: 401 }), false);
  assert.equal(isRetryableError({ status: 404 }), false);
});

test("classifies network errors as retryable and credentials as not", () => {
  assert.equal(isRetryableError(new TypeError("fetch failed")), true);
  assert.equal(isRetryableError({ name: "APIConnectionError" }), true);
  assert.equal(isRetryableError({ code: "ECONNRESET" }), true);
  assert.equal(isRetryableError(new CredentialRejectedError()), false);
  assert.equal(isRetryableError(new Error("nope")), false);
});

test("exponential backoff is capped and honours Retry-After as a minimum", () => {
  const noJitter = () => 0.5;
  assert.equal(computeRetryDelayMs(1, policy, {}, noJitter), 100);
  assert.equal(computeRetryDelayMs(2, policy, {}, noJitter), 200);
  assert.equal(computeRetryDelayMs(5, policy, {}, noJitter), 1000);

  const retryAfter = {
    status: 429,
    headers: { get: (name: string) => (name === "retry-after" ? "5" : null) },
  };
  assert.equal(computeRetryDelayMs(1, policy, retryAfter, noJitter), 5000);
});

test("retries until success and reports each delay", async () => {
  const delays: number[] = [];
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw { status: 503 };
      return "ok";
    },
    policy,
    {
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 0.5,
    },
  );

  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [100, 200]);
});

test("does not retry a non-retryable error", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw { status: 400 };
      },
      policy,
      { sleep: async () => {} },
    ),
    (error: unknown) => {
      assert.equal((error as { status: number }).status, 400);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("gives up after maxAttempts", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw { status: 429 };
      },
      policy,
      { sleep: async () => {}, random: () => 0.5 },
    ),
  );
  assert.equal(calls, 3);
});

function makePlan(): ExplainerPlan {
  return {
    schemaVersion: 2,
    title: "t",
    repositoryName: "r",
    branchName: "feature/x",
    baseRef: "main",
    generatedAt: "2020-01-01T00:00:00Z",
    scenes: [
      {
        id: "scene-1",
        title: "One",
        purpose: "p",
        narrationText: "First scene narration.",
        visual: "summary",
        sourceLocations: [],
        highlights: [],
      },
    ],
    omissions: [],
    caveats: [],
  };
}

test("narratePlan retries a transient provider failure before succeeding", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "explain-branch-retry-"));
  try {
    let calls = 0;
    const provider: SpeechProvider = {
      async synthesize() {
        calls += 1;
        if (calls < 3) throw { status: 429 };
        return createSilenceWav(1000);
      },
    };

    const result = await narratePlan({
      plan: makePlan(),
      config: DEFAULT_NARRATION_CONFIG,
      audioDir: path.join(dir, "audio"),
      relativeAudioDir: "artifacts/run/audio",
      provider,
      retryPolicy: {
        maxAttempts: 5,
        initialDelayMs: 1,
        maxDelayMs: 1,
        factor: 1,
        jitter: 0,
      },
      retryHooks: { sleep: async () => {} },
    });

    assert.equal(calls, 3);
    assert.equal(result.clips.length, 1);
    assert.ok(result.clips[0]!.durationMs > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("narratePlan surfaces a non-retryable provider error immediately", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "explain-branch-retry-"));
  try {
    let calls = 0;
    const provider: SpeechProvider = {
      async synthesize() {
        calls += 1;
        throw { status: 400, message: "bad request" };
      },
    };

    await assert.rejects(
      narratePlan({
        plan: makePlan(),
        config: DEFAULT_NARRATION_CONFIG,
        audioDir: path.join(dir, "audio"),
        relativeAudioDir: "artifacts/run/audio",
        provider,
        retryHooks: { sleep: async () => {} },
      }),
    );
    assert.equal(calls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
