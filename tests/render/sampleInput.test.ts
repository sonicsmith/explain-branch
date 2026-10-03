import test from "node:test";
import assert from "node:assert/strict";
import { validatePlan } from "../../src/analysis/validatePlan.ts";
import { snapshotFromContents } from "../../src/analysis/sourceSnapshot.ts";
import { sampleInput } from "../../src/render/fixtures/sampleInput.ts";
import {
  resolveRenderOptions,
  totalDurationInFrames,
} from "../../src/render/RenderInput.ts";

test("the fixture render input satisfies the plan schema", () => {
  const snapshot = snapshotFromContents(sampleInput.sources);
  const result = validatePlan(sampleInput.plan, { snapshot });

  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
});

test("the fixture renders a deterministic, evenly divided timeline", () => {
  const options = resolveRenderOptions(sampleInput.options);

  assert.equal(options.fps, 30);
  assert.equal(options.secondsPerScene, 8);
  assert.equal(
    totalDurationInFrames(sampleInput),
    sampleInput.plan.scenes.length * 8 * 30,
  );
  assert.equal(totalDurationInFrames(sampleInput), 960);
});

test("every scene has resolvable source or a self-contained change list", () => {
  for (const scene of sampleInput.plan.scenes) {
    const resolvable = scene.sourceLocations.some(
      (location) => sampleInput.sources[location.file] !== undefined,
    );
    const hasChanges = (scene.changes ?? []).length > 0;

    assert.ok(
      resolvable || hasChanges || scene.visual === "summary",
      `scene ${scene.id} has neither source nor changes`,
    );
  }
});
