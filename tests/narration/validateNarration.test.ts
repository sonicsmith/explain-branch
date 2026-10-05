import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { snapshotFromContents } from "../../src/analysis/sourceSnapshot.ts";
import { validateNarratedPlan } from "../../src/narration/validateNarration.ts";
import { createSilenceWav } from "../../src/narration/wav.ts";
import type {
  ExplainerPlan,
  ExplainerScene,
} from "../../src/planning/types.ts";

const AUDIO_PATH = "artifacts/run/audio/scene-1.wav";

function scene(overrides: Partial<ExplainerScene> = {}): ExplainerScene {
  return {
    id: "scene-1",
    title: "One",
    purpose: "p",
    narrationText: "First scene narration.",
    visual: "summary",
    sourceLocations: [],
    highlights: [],
    narrationAudioPath: AUDIO_PATH,
    narrationDurationMs: 1000,
    ...overrides,
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

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "explain-branch-validate-"));
}

async function writeClip(root: string, bytes: Uint8Array): Promise<void> {
  const absolute = path.join(root, ...AUDIO_PATH.split("/"));
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
}

const snapshot = snapshotFromContents({});

test("accepts a plan whose clips exist and match their recorded duration", async () => {
  const dir = await tempDir();
  try {
    await writeClip(dir, createSilenceWav(1000));
    const result = await validateNarratedPlan({
      plan: plan([scene()]),
      repositoryRoot: dir,
      snapshot,
    });
    assert.deepEqual(result.audioErrors, []);
    assert.deepEqual(result.planErrors, []);
    assert.equal(result.valid, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports a missing clip", async () => {
  const dir = await tempDir();
  try {
    const result = await validateNarratedPlan({
      plan: plan([scene()]),
      repositoryRoot: dir,
      snapshot,
    });
    assert.equal(result.valid, false);
    assert.match(result.audioErrors[0]?.message ?? "", /not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports an empty clip", async () => {
  const dir = await tempDir();
  try {
    await writeClip(dir, new Uint8Array(0));
    const result = await validateNarratedPlan({
      plan: plan([scene()]),
      repositoryRoot: dir,
      snapshot,
    });
    assert.equal(result.valid, false);
    assert.match(result.audioErrors[0]?.message ?? "", /empty/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports a duration mismatch beyond the tolerance", async () => {
  const dir = await tempDir();
  try {
    await writeClip(dir, createSilenceWav(1000));
    const result = await validateNarratedPlan({
      plan: plan([scene({ narrationDurationMs: 5000 })]),
      repositoryRoot: dir,
      snapshot,
    });
    assert.equal(result.valid, false);
    assert.match(result.audioErrors[0]?.message ?? "", /does not match/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports a clip that cannot be decoded", async () => {
  const dir = await tempDir();
  try {
    await writeClip(dir, new Uint8Array([1, 2, 3, 4]));
    const result = await validateNarratedPlan({
      plan: plan([scene()]),
      repositoryRoot: dir,
      snapshot,
      measureDuration: async () => {
        throw new Error("bad container");
      },
    });
    assert.equal(result.valid, false);
    assert.match(result.audioErrors[0]?.message ?? "", /could not be decoded/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("requires narration audio when a scene lacks it", async () => {
  const dir = await tempDir();
  try {
    const result = await validateNarratedPlan({
      plan: plan([
        scene({
          narrationAudioPath: undefined,
          narrationDurationMs: undefined,
        }),
      ]),
      repositoryRoot: dir,
      snapshot,
    });
    assert.equal(result.valid, false);
    assert.ok(
      result.planErrors.some((issue) =>
        issue.path.endsWith("narrationAudioPath"),
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
