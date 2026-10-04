import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCaptionChunks,
  buildSceneCaptions,
  splitSentences,
} from "../../src/render/captions.ts";
import type { SceneTiming } from "../../src/render/timeline.ts";
import type { ExplainerScene } from "../../src/planning/types.ts";

function scene(narrationText: string): ExplainerScene {
  return {
    id: "scene-1",
    title: "t",
    purpose: "p",
    narrationText,
    visual: "summary",
    sourceLocations: [],
    highlights: [],
  };
}

function timing(overrides: Partial<SceneTiming> = {}): SceneTiming {
  return {
    sceneId: "scene-1",
    fromFrame: 0,
    durationInFrames: 150,
    startMs: 0,
    durationMs: 5000,
    narrationMs: 3000,
    narrationStartFrame: 15,
    narrated: true,
    ...overrides,
  };
}

test("splits narration into sentences", () => {
  assert.deepEqual(splitSentences("One. Two! Three?"), [
    "One.",
    "Two!",
    "Three?",
  ]);
  assert.deepEqual(splitSentences("  spaced    out.  Next. "), [
    "spaced out.",
    "Next.",
  ]);
  assert.deepEqual(splitSentences(""), []);
});

test("distributes the narration span across sentences by length", () => {
  const chunks = buildCaptionChunks("aa. bbbb.", {
    startFrame: 10,
    spanFrames: 60,
  });

  assert.equal(chunks.length, 2);
  // Weights 3 and 5 over 60 frames -> boundaries at 10 and 10 + round(22.5) = 33.
  assert.equal(chunks[0]?.fromFrame, 10);
  assert.equal(chunks[0]?.durationInFrames, 23);
  assert.equal(chunks[1]?.fromFrame, 33);
  assert.equal(chunks[1]?.durationInFrames, 37);

  const sum = chunks.reduce(
    (total, chunk) => total + chunk.durationInFrames,
    0,
  );
  assert.equal(sum, 60);
  const last = chunks[chunks.length - 1];
  assert.equal((last?.fromFrame ?? 0) + (last?.durationInFrames ?? 0), 70);
});

test("a single sentence spans the whole narration", () => {
  const chunks = buildCaptionChunks("Just one sentence.", {
    startFrame: 5,
    spanFrames: 45,
  });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.fromFrame, 5);
  assert.equal(chunks[0]?.durationInFrames, 45);
});

test("empty narration produces no chunks", () => {
  assert.deepEqual(
    buildCaptionChunks("   ", { startFrame: 0, spanFrames: 30 }),
    [],
  );
});

test("narrated scenes chunk within the narration span", () => {
  const chunks = buildSceneCaptions(
    scene("First part. Second part."),
    timing({ narrationMs: 3000, narrationStartFrame: 15 }),
    30,
  );
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.fromFrame, 15);
  const narrationFrames = Math.round((3000 / 1000) * 30);
  const last = chunks[chunks.length - 1];
  assert.equal(
    (last?.fromFrame ?? 0) + (last?.durationInFrames ?? 0),
    15 + narrationFrames,
  );
});

test("silent scenes show the whole line for the scene", () => {
  const chunks = buildSceneCaptions(
    scene("A silent caption."),
    timing({ narrated: false, narrationMs: null, narrationStartFrame: 0 }),
    30,
  );
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.text, "A silent caption.");
  assert.equal(chunks[0]?.fromFrame, 0);
  assert.equal(chunks[0]?.durationInFrames, 150);
});
