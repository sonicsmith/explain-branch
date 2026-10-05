import test from "node:test";
import assert from "node:assert/strict";
import { buildSceneCaptions } from "../../src/render/captions.ts";
import { distributeFrameWindows } from "../../src/render/chunkTiming.ts";
import { activeStep, buildStepWindows } from "../../src/render/steps.ts";
import type { ExplainerScene } from "../../src/planning/types.ts";
import type { SceneTiming } from "../../src/render/timeline.ts";

function sceneWithSteps(steps: ExplainerScene["steps"]): ExplainerScene {
  return {
    id: "scene-1",
    title: "Changes in src",
    purpose: "Explain the change.",
    narrationText: (steps ?? []).map((step) => step.narration).join(" "),
    visual: "code-walkthrough",
    sourceLocations: [{ file: "src/app.ts", startLine: 1, endLine: 40 }],
    highlights: [],
    ...(steps !== undefined ? { steps } : {}),
  };
}

const TIMING: SceneTiming = {
  sceneId: "scene-1",
  fromFrame: 0,
  durationInFrames: 300,
  startMs: 0,
  durationMs: 10000,
  narrationMs: 4000,
  narrationStartFrame: 15,
  narrated: true,
};

test("distributeFrameWindows splits a span proportionally and exhaustively", () => {
  const windows = distributeFrameWindows([10, 30], {
    startFrame: 15,
    spanFrames: 120,
  });
  assert.equal(windows.length, 2);
  assert.equal(windows[0]?.fromFrame, 15);
  assert.equal(windows[1]?.fromFrame, 45);
  const total = windows.reduce((sum, w) => sum + w.durationInFrames, 0);
  assert.equal(total, 120);
  const last = windows[windows.length - 1];
  assert.equal(
    (last?.fromFrame ?? 0) + (last?.durationInFrames ?? 0),
    15 + 120,
  );

  assert.deepEqual(
    distributeFrameWindows([], { startFrame: 0, spanFrames: 100 }),
    [],
  );
});

test("buildStepWindows spans exactly the scene's narration", () => {
  const scene = sceneWithSteps([
    { narration: "short one", file: "src/app.ts", startLine: 1, endLine: 2 },
    {
      narration: "a much longer explanation of the next few lines",
      file: "src/app.ts",
      startLine: 3,
      endLine: 6,
    },
  ]);

  const windows = buildStepWindows(scene, TIMING, 30);
  assert.equal(windows.length, 2);
  assert.equal(windows[0]?.fromFrame, TIMING.narrationStartFrame);
  const total = windows.reduce((sum, w) => sum + w.durationInFrames, 0);
  assert.equal(total, Math.round((TIMING.narrationMs! / 1000) * 30));
  // The longer narration gets the larger window.
  assert.ok(
    (windows[1]?.durationInFrames ?? 0) > (windows[0]?.durationInFrames ?? 0),
  );
});

test("buildStepWindows is empty for scenes without steps", () => {
  assert.deepEqual(buildStepWindows(sceneWithSteps(undefined), TIMING, 30), []);
});

test("activeStep clamps before, inside, and after the span", () => {
  const scene = sceneWithSteps([
    { narration: "first", file: "src/app.ts", startLine: 1, endLine: 2 },
    { narration: "second", file: "src/app.ts", startLine: 3, endLine: 6 },
  ]);
  const windows = buildStepWindows(scene, TIMING, 30);

  assert.equal(activeStep([], 0), null);
  assert.equal(activeStep(windows, 0)?.stepIndex, 0); // before narration starts
  assert.equal(activeStep(windows, windows[1]!.fromFrame)?.stepIndex, 1);
  assert.equal(
    activeStep(windows, TIMING.durationInFrames + 50)?.stepIndex,
    1, // after the span: clamp to the last step
  );
});

test("stepped captions follow the step windows", () => {
  const scene = sceneWithSteps([
    { narration: "First step.", file: "src/app.ts", startLine: 1, endLine: 2 },
    { narration: "Second step.", file: "src/app.ts", startLine: 3, endLine: 6 },
  ]);
  const captions = buildSceneCaptions(scene, TIMING, 30);
  const windows = buildStepWindows(scene, TIMING, 30);

  assert.equal(captions.length, 2);
  assert.deepEqual(
    captions.map((c) => c.text),
    ["First step.", "Second step."],
  );
  assert.equal(captions[0]?.fromFrame, windows[0]?.fromFrame);
  assert.equal(captions[1]?.durationInFrames, windows[1]?.durationInFrames);
});
