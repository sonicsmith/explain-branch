import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import {
  buildChangeInventory,
  BaseResolutionError,
  type ChangeInventory,
} from "../../src/analysis/buildChangeInventory.ts";
import { TempRepo } from "../helpers/tempRepo.ts";

function findFile(inventory: ChangeInventory, filePath: string) {
  return inventory.files.find((file) => file.path === filePath);
}

test("inventories added, modified, deleted and renamed files against an explicit base", async (t) => {
  const repo = await TempRepo.create();
  t.after(() => repo.cleanup());

  await repo.write("src/main.ts", "export const value = 1;\n");
  await repo.write("src/old.ts", "export const gone = true;\n");
  await repo.write("src/keep.ts", "export const keep = true;\n");
  await repo.commit("base");

  await repo.git(["checkout", "-b", "feature"]);
  await repo.write(
    "src/main.ts",
    "export const value = 2;\nexport const extra = 3;\n",
  );
  await repo.write("src/new.ts", "export const fresh = true;\n");
  await repo.git(["rm", "src/old.ts"]);
  await repo.git(["mv", "src/keep.ts", "src/renamed.ts"]);
  await repo.commit("feature changes");

  const inventory = await buildChangeInventory({
    repoPath: repo.dir,
    base: "main",
  });

  assert.equal(inventory.currentBranch, "feature");
  assert.equal(inventory.detachedHead, false);
  assert.equal(inventory.base?.source, "explicit");
  assert.equal(inventory.base?.ref, "main");
  assert.ok(inventory.base?.mergeBase);

  const main = findFile(inventory, "src/main.ts");
  assert.equal(main?.changeType, "modified");
  assert.equal(main?.language, "typescript");
  assert.ok((main?.addedLineCount ?? 0) >= 2);

  assert.equal(findFile(inventory, "src/new.ts")?.changeType, "added");
  assert.equal(findFile(inventory, "src/old.ts")?.changeType, "deleted");

  const renamed = findFile(inventory, "src/renamed.ts");
  assert.equal(renamed?.changeType, "renamed");
  assert.equal(renamed?.oldPath, "src/keep.ts");
});

test("uses a configured base from .explain-branch.json", async (t) => {
  const repo = await TempRepo.create();
  t.after(() => repo.cleanup());

  await repo.write(
    ".explain-branch.json",
    `${JSON.stringify({ base: "main" })}\n`,
  );
  await repo.write("src/app.ts", "export const a = 1;\n");
  await repo.commit("base");

  await repo.git(["checkout", "-b", "feature"]);
  await repo.write("src/app.ts", "export const a = 2;\n");
  await repo.commit("change");

  const inventory = await buildChangeInventory({ repoPath: repo.dir });

  assert.equal(inventory.base?.source, "config");
  assert.equal(inventory.base?.ref, "main");
});

test("throws a BaseResolutionError when the conventional base is ambiguous", async (t) => {
  const repo = await TempRepo.create();
  t.after(() => repo.cleanup());

  await repo.write("src/app.ts", "export const a = 1;\n");
  await repo.commit("base");
  await repo.git(["branch", "master"]);
  await repo.git(["checkout", "-b", "feature"]);
  await repo.write("src/app.ts", "export const a = 2;\n");
  await repo.commit("change");

  await assert.rejects(
    () => buildChangeInventory({ repoPath: repo.dir }),
    (error: unknown) =>
      error instanceof BaseResolutionError && /ambiguous/.test(error.message),
  );
});

test("throws with guidance when no base can be determined", async (t) => {
  const repo = await TempRepo.create("trunk");
  t.after(() => repo.cleanup());

  await repo.write("src/app.ts", "export const a = 1;\n");
  await repo.commit("base");

  await assert.rejects(
    () => buildChangeInventory({ repoPath: repo.dir }),
    (error: unknown) =>
      error instanceof BaseResolutionError &&
      /Could not determine/.test(error.message),
  );
});

test("excludes working-tree changes by default and includes them on request", async (t) => {
  const repo = await TempRepo.create();
  t.after(() => repo.cleanup());

  await repo.write("src/app.ts", "export const a = 1;\n");
  await repo.commit("base");
  await repo.git(["checkout", "-b", "feature"]);
  await repo.write("src/app.ts", "export const a = 2;\n");
  await repo.commit("branch change");
  await repo.write("src/app.ts", "export const a = 3;\n"); // uncommitted

  const excluded = await buildChangeInventory({
    repoPath: repo.dir,
    base: "main",
  });
  assert.equal(excluded.workingTree.isDirty, true);
  assert.equal(excluded.workingTree.included, false);
  assert.equal(
    excluded.files.some((file) => file.source === "working-tree"),
    false,
  );
  assert.ok(
    excluded.warnings.some((warning) => warning.includes("NOT included")),
  );

  const included = await buildChangeInventory({
    repoPath: repo.dir,
    base: "main",
    includeWorkingTree: true,
  });
  assert.equal(included.workingTree.included, true);
  assert.ok(
    included.files.some(
      (file) => file.source === "working-tree" && file.path === "src/app.ts",
    ),
  );
});

test("never modifies repository state", async (t) => {
  const repo = await TempRepo.create();
  t.after(() => repo.cleanup());

  await repo.write("src/app.ts", "export const a = 1;\n");
  await repo.commit("base");
  await repo.git(["checkout", "-b", "feature"]);
  await repo.write("src/app.ts", "export const a = 2;\n");
  await repo.commit("branch change");
  await repo.write("src/dirty.ts", "export const dirty = true;\n");

  const headBefore = (await repo.git(["rev-parse", "HEAD"])).trim();
  const statusBefore = await repo.git(["status", "--porcelain"]);
  const refsBefore = await repo.git(["show-ref"]);

  await buildChangeInventory({
    repoPath: repo.dir,
    base: "main",
    includeWorkingTree: true,
  });

  assert.equal((await repo.git(["rev-parse", "HEAD"])).trim(), headBefore);
  assert.equal(await repo.git(["status", "--porcelain"]), statusBefore);
  assert.equal(await repo.git(["show-ref"]), refsBefore);
});

test("handles a detached HEAD", async (t) => {
  const repo = await TempRepo.create();
  t.after(() => repo.cleanup());

  await repo.write("src/app.ts", "export const a = 1;\n");
  const firstCommit = await repo.commit("first");
  await repo.write("src/app.ts", "export const a = 2;\n");
  await repo.commit("second");
  await repo.git(["checkout", firstCommit]);

  const inventory = await buildChangeInventory({ repoPath: repo.dir });

  assert.equal(inventory.detachedHead, true);
  assert.equal(inventory.currentBranch, null);
  assert.equal(inventory.base?.source, "conventional");
});

test("reports a shallow clone", async (t) => {
  const repo = await TempRepo.create();
  t.after(() => repo.cleanup());

  await repo.write("src/app.ts", "export const a = 1;\n");
  await repo.commit("one");
  await repo.write("src/app.ts", "export const a = 2;\n");
  await repo.commit("two");

  const cloneDir = await TempRepo.shallowClone(repo.dir);
  t.after(() => rm(cloneDir, { recursive: true, force: true }));

  const inventory = await buildChangeInventory({ repoPath: cloneDir });

  assert.equal(inventory.isShallow, true);
  assert.ok(
    inventory.warnings.some((warning) =>
      warning.toLowerCase().includes("shallow"),
    ),
  );
});
