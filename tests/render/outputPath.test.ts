import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveOutputPath } from "../../src/render/outputPath.ts";

const fixedClock = () => new Date("2020-01-01T00:00:00Z");

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "explain-branch-output-"));
}

test("returns the desired path when nothing exists", async () => {
  const dir = await tempDir();
  try {
    const target = path.join(dir, "branch-explainer.mp4");
    const result = await resolveOutputPath(target, { now: fixedClock });
    assert.deepEqual(result, { path: target, collided: false });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("displaces an existing file with a timestamped name", async () => {
  const dir = await tempDir();
  try {
    const target = path.join(dir, "branch-explainer.mp4");
    await writeFile(target, "old");
    const result = await resolveOutputPath(target, { now: fixedClock });
    assert.equal(result.collided, true);
    assert.equal(
      result.path,
      path.join(dir, "branch-explainer-20200101-000000.mp4"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("adds a counter when the timestamped name also exists", async () => {
  const dir = await tempDir();
  try {
    const target = path.join(dir, "branch-explainer.mp4");
    await writeFile(target, "old");
    await writeFile(
      path.join(dir, "branch-explainer-20200101-000000.mp4"),
      "also old",
    );
    const result = await resolveOutputPath(target, { now: fixedClock });
    assert.equal(
      result.path,
      path.join(dir, "branch-explainer-20200101-000000-2.mp4"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reuses the desired path when overwrite is allowed", async () => {
  const dir = await tempDir();
  try {
    const target = path.join(dir, "branch-explainer.mp4");
    await writeFile(target, "old");
    const result = await resolveOutputPath(target, {
      overwrite: true,
      now: fixedClock,
    });
    assert.deepEqual(result, { path: target, collided: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
