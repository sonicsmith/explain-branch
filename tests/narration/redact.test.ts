import test from "node:test";
import assert from "node:assert/strict";
import {
  redactPlanNarration,
  redactSecrets,
} from "../../src/narration/redact.ts";
import type {
  ExplainerPlan,
  ExplainerScene,
} from "../../src/planning/types.ts";

test("redacts an OpenAI API key", () => {
  const secret = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789";
  const result = redactSecrets(`The key is ${secret}.`);
  assert.ok(!result.text.includes(secret));
  assert.match(result.text, /\[REDACTED:openai-key\]/);
  assert.equal(result.redactions[0]?.kind, "openai-key");
});

test("redacts common credential formats", () => {
  const cases: Array<[string, string]> = [
    ["ghp_0123456789abcdefghijklmnopqrstuvwxyz", "github-token"],
    ["xoxb-1234567890-abcdefghijkl", "slack-token"],
    ["AKIAIOSFODNN7EXAMPLE", "aws-access-key"],
    ["Bearer abcdefghijklmnop.qrstuvwx", "bearer-token"],
    ["API_TOKEN=abc123def456", "env-assignment"],
    ["https://user:hunter2@example.com/path", "url-credentials"],
  ];
  for (const [input, kind] of cases) {
    const result = redactSecrets(`value ${input} here`);
    assert.ok(
      result.redactions.some((entry) => entry.kind === kind),
      `expected ${kind} for "${input}"`,
    );
  }
});

test("redacts PEM private key blocks", () => {
  const pem =
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
  const result = redactSecrets(`Here:\n${pem}\nDone.`);
  assert.ok(!result.text.includes("MIIEowIBAAKCAQEA"));
  assert.match(result.text, /\[REDACTED:private-key\]/);
});

test("leaves ordinary prose and code identifiers untouched", () => {
  const text =
    "This change updates src/render/timeline.ts and introduces totalDurationInFrames, which sums the scene frames.";
  const result = redactSecrets(text);
  assert.equal(result.text, text);
  assert.deepEqual(result.redactions, []);
});

function scene(id: string, narrationText: string): ExplainerScene {
  return {
    id,
    title: id,
    purpose: "p",
    narrationText,
    visual: "summary",
    sourceLocations: [],
    highlights: [],
  };
}

function plan(scenes: ExplainerScene[]): ExplainerPlan {
  return {
    schemaVersion: 3,
    title: "t",
    repositoryName: "r",
    branchName: "b",
    baseRef: "main",
    generatedAt: "2020-01-01T00:00:00Z",
    scenes,
    omissions: [],
    caveats: [],
  };
}

test("redacts narration text across scenes and reports what was filtered", () => {
  const result = redactPlanNarration(
    plan([
      scene(
        "scene-1",
        "Set OPENAI_API_KEY=sk-abcdefghijklmnop1234 and continue.",
      ),
      scene("summary", "Nothing sensitive here."),
    ]),
  );

  assert.equal(result.totalRedactions >= 1, true);
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0]?.sceneId, "scene-1");
  assert.ok(
    !(result.plan.scenes[0]?.narrationText ?? "").includes(
      "sk-abcdefghijklmnop1234",
    ),
  );
  assert.equal(result.plan.scenes[1]?.narrationText, "Nothing sensitive here.");
});

test("returns the same plan object when nothing needs redacting", () => {
  const input = plan([scene("scene-1", "A clean sentence about the change.")]);
  const result = redactPlanNarration(input);
  assert.equal(result.plan, input);
  assert.deepEqual(result.reports, []);
  assert.equal(result.totalRedactions, 0);
});
