import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validatePlan } from "../../src/analysis/validatePlan.ts";
import { snapshotFromContents } from "../../src/analysis/sourceSnapshot.ts";
import { FakeSpeechProvider } from "../../src/narration/fakeSpeechProvider.ts";
import { narratePlan } from "../../src/narration/narratePlan.ts";
import {
  NarrationError,
  type SpeechProvider,
} from "../../src/narration/provider.ts";
import {
  DEFAULT_NARRATION_CONFIG,
  type NarrationConfig,
} from "../../src/narration/types.ts";
import type {
  ExplainerPlan,
  ExplainerScene,
} from "../../src/planning/types.ts";

function scene(id: string, narrationText: string): ExplainerScene {
  return {
    id,
    title: id,
    purpose: "test scene",
    narrationText,
    visual: "summary",
    sourceLocations: [],
    highlights: [],
  };
}

function makePlan(scenes?: ExplainerScene[]): ExplainerPlan {
  return {
    schemaVersion: 2,
    title: "Test plan",
    repositoryName: "repo",
    branchName: "feature/x",
    baseRef: "main",
    generatedAt: "2020-01-01T00:00:00Z",
    scenes: scenes ?? [
      scene("scene-1", "First scene narration."),
      scene("summary", "Second scene narration."),
    ],
    omissions: [],
    caveats: [],
  };
}

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "explain-branch-narrate-"));
}

function baseOptions(
  dir: string,
  config: NarrationConfig = DEFAULT_NARRATION_CONFIG,
) {
  return {
    plan: makePlan(),
    config,
    audioDir: path.join(dir, "artifacts", "run", "audio"),
    relativeAudioDir: "artifacts/run/audio",
    now: () => new Date("2020-01-01T00:00:00Z"),
  };
}

test("generates one clip per scene and records repo-relative paths + durations", async () => {
  const dir = await tempDir();
  try {
    const provider = new FakeSpeechProvider();
    const result = await narratePlan({ ...baseOptions(dir), provider });

    assert.equal(result.clips.length, 2);
    assert.equal(provider.requests.length, 2);
    assert.equal(
      result.plan.scenes[0]?.narrationAudioPath,
      "artifacts/run/audio/scene-1.wav",
    );
    assert.equal(
      result.plan.scenes[1]?.narrationAudioPath,
      "artifacts/run/audio/summary.wav",
    );

    for (const clip of result.clips) {
      assert.ok(clip.durationMs > 0);
      assert.equal(clip.cached, false);
      assert.ok(clip.absolutePath !== undefined);
      const info = await stat(clip.absolutePath);
      assert.ok(info.size > 0);
    }

    const files = (
      await readdir(path.join(dir, "artifacts", "run", "audio"))
    ).sort();
    assert.deepEqual(files, [
      "scene-1.wav",
      "scene-1.wav.json",
      "summary.wav",
      "summary.wav.json",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the enriched plan passes validation with requireNarrationAudio", async () => {
  const dir = await tempDir();
  try {
    const provider = new FakeSpeechProvider();
    const result = await narratePlan({ ...baseOptions(dir), provider });
    const validation = validatePlan(result.plan, {
      snapshot: snapshotFromContents({}),
      requireNarrationAudio: true,
    });
    assert.deepEqual(validation.errors, []);
    assert.equal(validation.valid, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reuses cached clips on a second run without re-billing", async () => {
  const dir = await tempDir();
  try {
    const provider = new FakeSpeechProvider();
    const options = { ...baseOptions(dir), provider };
    const first = await narratePlan(options);
    const second = await narratePlan(options);

    assert.equal(provider.requests.length, 2);
    assert.ok(second.clips.every((clip) => clip.cached));
    assert.equal(
      second.plan.scenes[0]?.narrationDurationMs,
      first.plan.scenes[0]?.narrationDurationMs,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("force regenerates every clip", async () => {
  const dir = await tempDir();
  try {
    const provider = new FakeSpeechProvider();
    const options = { ...baseOptions(dir), provider };
    await narratePlan(options);
    const forced = await narratePlan({ ...options, force: true });

    assert.equal(provider.requests.length, 4);
    assert.ok(forced.clips.every((clip) => !clip.cached));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--scene regenerates only the selected clip", async () => {
  const dir = await tempDir();
  try {
    const provider = new FakeSpeechProvider();
    const options = { ...baseOptions(dir), provider };
    await narratePlan(options);
    const scoped = await narratePlan({ ...options, sceneIds: ["scene-1"] });

    assert.equal(provider.requests.length, 3);
    const summary = scoped.clips.find((clip) => clip.sceneId === "summary");
    assert.equal(summary?.cached, true);
    const first = scoped.clips.find((clip) => clip.sceneId === "scene-1");
    assert.equal(first?.cached, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects an unknown scene id", async () => {
  const dir = await tempDir();
  try {
    const provider = new FakeSpeechProvider();
    await assert.rejects(
      narratePlan({ ...baseOptions(dir), provider, sceneIds: ["nope"] }),
      /Unknown scene "nope"/,
    );
    assert.equal(provider.requests.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dry run reports characters and cost without calling the provider or writing files", async () => {
  const dir = await tempDir();
  try {
    const result = await narratePlan({ ...baseOptions(dir), dryRun: true });
    assert.equal(result.dryRun, true);
    assert.ok(result.clips.every((clip) => clip.audioPath === undefined));
    assert.equal(result.plan.scenes[0]?.narrationAudioPath, undefined);
    assert.equal(
      result.totalCharacters,
      "First scene narration.".length + "Second scene narration.".length,
    );
    assert.equal(result.costEstimate.complete, false);
    await assert.rejects(stat(path.join(dir, "artifacts", "run", "audio")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fails loudly when narration exceeds the request character limit", async () => {
  const dir = await tempDir();
  try {
    const plan = makePlan([scene("scene-1", "x".repeat(5000))]);
    await assert.rejects(
      narratePlan({ ...baseOptions(dir), plan, dryRun: true }),
      NarrationError,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("uses the WAV header fast path even when the format is not wav", async () => {
  const dir = await tempDir();
  try {
    // The fake provider returns real WAV bytes; magic-byte detection wins over the label.
    const provider = new FakeSpeechProvider();
    const config: NarrationConfig = {
      ...DEFAULT_NARRATION_CONFIG,
      format: "mp3",
    };
    let ffprobeCalled = false;
    const result = await narratePlan({
      ...baseOptions(dir, config),
      provider,
      ffprobe: async () => {
        ffprobeCalled = true;
        return 1;
      },
    });
    assert.ok(result.clips.every((clip) => clip.durationMs > 0));
    assert.equal(ffprobeCalled, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("measures non-WAV clips with the injected FFprobe fallback", async () => {
  const dir = await tempDir();
  try {
    const provider: SpeechProvider = {
      async synthesize() {
        return new Uint8Array([0x49, 0x44, 0x33, 0x04]); // "ID3"-prefixed bytes
      },
    };
    const config: NarrationConfig = {
      ...DEFAULT_NARRATION_CONFIG,
      format: "mp3",
    };
    const probed: string[] = [];
    const result = await narratePlan({
      ...baseOptions(dir, config),
      provider,
      ffprobe: async (filePath) => {
        probed.push(filePath);
        return 4321;
      },
    });
    assert.equal(probed.length, 2);
    assert.ok(probed.every((filePath) => filePath.endsWith(".mp3")));
    assert.ok(result.clips.every((clip) => clip.durationMs === 4321));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
