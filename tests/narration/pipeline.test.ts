import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { snapshotFromContents } from "../../src/analysis/sourceSnapshot.ts";
import { FakeSpeechProvider } from "../../src/narration/fakeSpeechProvider.ts";
import { narratePlan } from "../../src/narration/narratePlan.ts";
import { DEFAULT_NARRATION_CONFIG } from "../../src/narration/types.ts";
import { validateNarratedPlan } from "../../src/narration/validateNarration.ts";
import {
  buildRenderTimeline,
  type RenderInput,
} from "../../src/render/RenderInput.ts";
import { assertTimelineConsistent } from "../../src/render/timeline.ts";
import type { ExplainerPlan } from "../../src/planning/types.ts";

function makePlan(): ExplainerPlan {
  return {
    schemaVersion: 3,
    title: "Pipeline",
    repositoryName: "repo",
    branchName: "feature/pipeline",
    baseRef: "main",
    generatedAt: "2020-01-01T00:00:00Z",
    scenes: [
      {
        id: "scene-1",
        title: "One",
        purpose: "p",
        narrationText: "The first change updates a file. It is short.",
        visual: "summary",
        sourceLocations: [],
        highlights: [],
      },
      {
        id: "scene-2",
        title: "Two",
        purpose: "p",
        narrationText:
          "The second change removes some code and simplifies the flow.",
        visual: "summary",
        sourceLocations: [],
        highlights: [],
      },
      {
        id: "summary",
        title: "Summary",
        purpose: "p",
        narrationText: "In total two areas changed.",
        visual: "summary",
        sourceLocations: [],
        highlights: [],
      },
    ],
    omissions: [],
    caveats: [],
  };
}

test("narrate -> plan -> timeline stays consistent and offline", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "explain-branch-pipeline-"));
  try {
    const provider = new FakeSpeechProvider();
    const narrated = await narratePlan({
      plan: makePlan(),
      config: DEFAULT_NARRATION_CONFIG,
      audioDir: path.join(dir, "artifacts", "run", "audio"),
      relativeAudioDir: "artifacts/run/audio",
      provider,
    });

    // One clip per scene, each with a recorded path and positive duration.
    assert.equal(provider.requests.length, narrated.plan.scenes.length);
    for (const scene of narrated.plan.scenes) {
      assert.ok(scene.narrationAudioPath);
      assert.ok((scene.narrationDurationMs ?? 0) > 0);
    }

    // The timeline derived from the narrated plan is internally consistent.
    const input: RenderInput = { plan: narrated.plan, sources: {} };
    const timeline = buildRenderTimeline(input);
    assertTimelineConsistent(timeline);
    assert.equal(timeline.scenes.length, narrated.plan.scenes.length);

    const sum = timeline.scenes.reduce(
      (total, timing) => total + timing.durationInFrames,
      0,
    );
    assert.equal(sum, timeline.durationInFrames);

    // No narration is cut off: each scene runs at least as long as its clip.
    narrated.plan.scenes.forEach((scene, index) => {
      const timing = timeline.scenes[index];
      const narrationFrames = Math.ceil(
        ((scene.narrationDurationMs ?? 0) / 1000) * timeline.fps,
      );
      assert.ok(
        (timing?.durationInFrames ?? 0) >= narrationFrames,
        `scene ${scene.id} is too short for its narration`,
      );
    });

    // The narrate-path validator accepts the fully offline result.
    const validation = await validateNarratedPlan({
      plan: narrated.plan,
      repositoryRoot: dir,
      snapshot: snapshotFromContents({}),
    });
    assert.equal(
      validation.valid,
      true,
      JSON.stringify([...validation.planErrors, ...validation.audioErrors]),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
