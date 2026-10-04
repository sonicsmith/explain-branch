import test from "node:test";
import assert from "node:assert/strict";
import {
  assertTimelineConsistent,
  buildTimeline,
  DEFAULT_TIMELINE_OPTIONS,
  timelineIssues,
  type Timeline,
  type TimelineOptions,
} from "../../src/render/timeline.ts";
import { NarrationError } from "../../src/narration/provider.ts";
import type {
  ExplainerPlan,
  ExplainerScene,
} from "../../src/planning/types.ts";

function scene(id: string, narrationDurationMs?: number): ExplainerScene {
  return {
    id,
    title: id,
    purpose: "test scene",
    narrationText: "narration",
    visual: "summary",
    sourceLocations: [],
    highlights: [],
    ...(narrationDurationMs !== undefined ? { narrationDurationMs } : {}),
  };
}

function plan(scenes: ExplainerScene[]): ExplainerPlan {
  return {
    schemaVersion: 2,
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

function options(overrides: Partial<TimelineOptions> = {}): TimelineOptions {
  return {
    fps: 30,
    secondsPerScene: 8,
    ...DEFAULT_TIMELINE_OPTIONS,
    ...overrides,
  };
}

test("narrated scenes run for lead-in + narration + tail", () => {
  const timeline = buildTimeline(
    plan([scene("scene-1", 2000)]),
    options({
      leadInMs: 500,
      tailMs: 750,
      gapMs: 0,
      minSceneMs: 0,
    }),
  );

  const timing = timeline.scenes[0];
  assert.equal(timing?.durationMs, 3250);
  // ceil(3.25 * 30) = ceil(97.5) = 98
  assert.equal(timing?.durationInFrames, 98);
  assert.equal(timing?.narrated, true);
  // A 500 ms lead-in at 30 fps = 15 frames before the clip starts.
  assert.equal(timing?.narrationStartFrame, 15);
  assert.equal(timeline.durationInFrames, 98);
});

test("applies the inter-scene gap only after the first scene", () => {
  const timeline = buildTimeline(
    plan([scene("scene-1", 1000), scene("scene-2", 1000)]),
    options({ leadInMs: 0, tailMs: 0, gapMs: 1000, minSceneMs: 0 }),
  );

  assert.equal(timeline.scenes[0]?.durationMs, 1000);
  assert.equal(timeline.scenes[0]?.durationInFrames, 30);
  assert.equal(timeline.scenes[1]?.durationMs, 2000);
  assert.equal(timeline.scenes[1]?.durationInFrames, 60);
  assert.equal(timeline.scenes[1]?.fromFrame, 30);
  assert.equal(timeline.scenes[1]?.startMs, 1000);
  assert.equal(timeline.durationInFrames, 90);
});

test("falls back to secondsPerScene for scenes without narration", () => {
  const timeline = buildTimeline(
    plan([scene("scene-1")]),
    options({
      secondsPerScene: 8,
    }),
  );
  assert.equal(timeline.scenes[0]?.narrated, false);
  assert.equal(timeline.scenes[0]?.narrationMs, null);
  assert.equal(timeline.scenes[0]?.narrationStartFrame, 0);
  assert.equal(timeline.scenes[0]?.durationMs, 8000);
  assert.equal(timeline.scenes[0]?.durationInFrames, 240);
});

test("clamps short scenes to the minimum length", () => {
  const timeline = buildTimeline(
    plan([scene("scene-1", 100)]),
    options({
      leadInMs: 0,
      tailMs: 0,
      gapMs: 0,
      minSceneMs: 2000,
    }),
  );
  assert.equal(timeline.scenes[0]?.durationMs, 2000);
  assert.equal(timeline.scenes[0]?.durationInFrames, 60);
});

test("ceil rounding never truncates narration", () => {
  const timeline = buildTimeline(
    plan([scene("scene-1", 1001)]),
    options({
      leadInMs: 0,
      tailMs: 0,
      gapMs: 0,
      minSceneMs: 0,
    }),
  );
  const timing = timeline.scenes[0];
  assert.equal(timing?.durationInFrames, 31); // ceil(1001/1000*30) = ceil(30.03)
  assert.ok((timing?.startMs ?? 0) >= 0);
  assert.ok(
    ((timing?.durationInFrames ?? 0) / 30) * 1000 >= (timing?.narrationMs ?? 0),
  );
});

test("sum(sceneFrames) always equals durationInFrames", () => {
  const timeline = buildTimeline(
    plan([scene("a", 1234), scene("b"), scene("c", 9999)]),
    options(),
  );
  const sum = timeline.scenes.reduce(
    (total, timing) => total + timing.durationInFrames,
    0,
  );
  assert.equal(sum, timeline.durationInFrames);
  assert.deepEqual(timelineIssues(timeline), []);
});

test("rejects a non-positive fps", () => {
  assert.throws(
    () => buildTimeline(plan([scene("a", 1000)]), options({ fps: 0 })),
    NarrationError,
  );
});

test("assertTimelineConsistent flags a mismatched durationInFrames", () => {
  const broken: Timeline = {
    fps: 30,
    scenes: [
      {
        sceneId: "a",
        fromFrame: 0,
        durationInFrames: 30,
        startMs: 0,
        durationMs: 1000,
        narrationMs: 1000,
        narrated: true,
      },
    ],
    durationInFrames: 99,
    durationMs: 3300,
  };
  assert.ok(timelineIssues(broken).length > 0);
  assert.throws(() => assertTimelineConsistent(broken), NarrationError);
});
