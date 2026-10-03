import test from "node:test";
import assert from "node:assert/strict";
import { buildChangeInventory } from "../../src/analysis/buildChangeInventory.ts";
import { validatePlan } from "../../src/analysis/validatePlan.ts";
import { buildPlan, collectSymbols } from "../../src/planning/buildPlan.ts";
import { parseUnifiedDiff } from "../../src/git/parseDiff.ts";
import { TempRepo } from "../helpers/tempRepo.ts";

const GENERATED_AT = "2026-01-01T00:00:00.000Z";

async function makeFixtureRepo(): Promise<TempRepo> {
  const repo = await TempRepo.create();

  await repo.write(
    "src/git/inspect.ts",
    "export const inspect = 1;\nexport const base = 2;\n",
  );
  await repo.write("src/analysis/plan.ts", "export const plan = 1;\n");
  await repo.write("src/legacy.ts", "export const legacy = 1;\n");
  await repo.write("README.md", "# Demo\n");
  await repo.write("package-lock.json", '{ "lockfileVersion": 3 }\n');
  await repo.commit("base");

  await repo.git(["checkout", "-b", "feature"]);
  await repo.write(
    "src/git/inspect.ts",
    "export const inspect = 2;\nexport const base = 3;\nexport const resolveBase = 4;\n",
  );
  await repo.write(
    "src/analysis/plan.ts",
    "export const plan = 2;\nexport function buildPlan() {\n  return 1;\n}\n",
  );
  await repo.write(
    "src/analysis/new.ts",
    "export interface Plan {\n  id: string;\n}\n",
  );
  await repo.write("README.md", "# Demo\n\nUpdated.\n");
  await repo.write("package-lock.json", '{ "lockfileVersion": 3, "x": 1 }\n');
  await repo.git(["rm", "src/legacy.ts"]);
  await repo.commit("feature changes");

  return repo;
}

test("produces a validated, grouped plan with a closing summary", async (t) => {
  const repo = await makeFixtureRepo();
  t.after(() => repo.cleanup());

  const inventory = await buildChangeInventory({
    repoPath: repo.dir,
    base: "main",
  });
  const { plan, snapshot } = await buildPlan({
    repositoryRoot: repo.dir,
    inventory,
    generatedAt: GENERATED_AT,
  });

  const validation = validatePlan(plan, { snapshot });
  assert.equal(
    validation.valid,
    true,
    JSON.stringify(validation.errors, null, 2),
  );

  assert.equal(plan.branchName, "feature");
  assert.equal(plan.baseRef, "main");
  assert.equal(plan.generatedAt, GENERATED_AT);
  assert.equal(plan.repositoryName, repo.dir.split("/").pop());

  const summary = plan.scenes.at(-1);
  assert.equal(summary?.id, "summary");
  assert.equal(summary?.visual, "summary");
  assert.equal(summary?.sourceLocations.length, 0);

  const codeScene = plan.scenes.find(
    (scene) => scene.visual === "code-walkthrough",
  );
  assert.ok(codeScene, "expected at least one code-walkthrough scene");
  assert.ok(codeScene.sourceLocations.length > 0);
  assert.ok(codeScene.highlights.length > 0);
  assert.ok(
    codeScene.sourceLocations.every((location) => snapshot.has(location.file)),
  );
});

test("groups related files into one scene rather than one scene per file", async (t) => {
  const repo = await makeFixtureRepo();
  t.after(() => repo.cleanup());

  const inventory = await buildChangeInventory({
    repoPath: repo.dir,
    base: "main",
  });
  const { plan } = await buildPlan({
    repositoryRoot: repo.dir,
    inventory,
    generatedAt: GENERATED_AT,
  });

  const analysisScene = plan.scenes.find((scene) =>
    scene.title.includes("src/analysis"),
  );
  assert.ok(analysisScene, "expected an src/analysis scene");
  assert.ok(
    analysisScene.sourceLocations.some(
      (location) => location.file === "src/analysis/plan.ts",
    ),
  );
  assert.ok(
    analysisScene.sourceLocations.some(
      (location) => location.file === "src/analysis/new.ts",
    ),
  );
});

test("grounds narration in the diff by naming changed symbols", async (t) => {
  const repo = await makeFixtureRepo();
  t.after(() => repo.cleanup());

  const inventory = await buildChangeInventory({
    repoPath: repo.dir,
    base: "main",
  });
  const { plan } = await buildPlan({
    repositoryRoot: repo.dir,
    inventory,
    generatedAt: GENERATED_AT,
  });

  const narration = plan.scenes.map((scene) => scene.narrationText).join(" ");
  assert.match(narration, /buildPlan/);
  assert.match(narration, /resolveBase/);
});

test("lists generated files as omissions", async (t) => {
  const repo = await makeFixtureRepo();
  t.after(() => repo.cleanup());

  const inventory = await buildChangeInventory({
    repoPath: repo.dir,
    base: "main",
  });
  const { plan } = await buildPlan({
    repositoryRoot: repo.dir,
    inventory,
    generatedAt: GENERATED_AT,
  });

  assert.ok(
    plan.omissions.some((omission) => omission.item === "package-lock.json"),
  );
  assert.match(
    plan.omissions.find((omission) => omission.item === "package-lock.json")
      ?.reason ?? "",
    /generated/,
  );
});

test("never references deleted files in source locations", async (t) => {
  const repo = await makeFixtureRepo();
  t.after(() => repo.cleanup());

  const inventory = await buildChangeInventory({
    repoPath: repo.dir,
    base: "main",
  });
  const { plan } = await buildPlan({
    repositoryRoot: repo.dir,
    inventory,
    generatedAt: GENERATED_AT,
  });

  const references = plan.scenes.flatMap((scene) =>
    scene.sourceLocations.map((location) => location.file),
  );
  assert.equal(references.includes("src/legacy.ts"), false);
});

test("is deterministic for the same inventory and timestamp", async (t) => {
  const repo = await makeFixtureRepo();
  t.after(() => repo.cleanup());

  const inventory = await buildChangeInventory({
    repoPath: repo.dir,
    base: "main",
  });
  const first = await buildPlan({
    repositoryRoot: repo.dir,
    inventory,
    generatedAt: GENERATED_AT,
  });
  const second = await buildPlan({
    repositoryRoot: repo.dir,
    inventory,
    generatedAt: GENERATED_AT,
  });

  assert.deepEqual(second.plan, first.plan);
});

test("respects the maxScenes budget and reports omissions", async (t) => {
  const repo = await makeFixtureRepo();
  t.after(() => repo.cleanup());

  const inventory = await buildChangeInventory({
    repoPath: repo.dir,
    base: "main",
  });
  const { plan, snapshot } = await buildPlan({
    repositoryRoot: repo.dir,
    inventory,
    maxScenes: 2,
    generatedAt: GENERATED_AT,
  });

  assert.equal(plan.scenes.length, 2);
  assert.equal(plan.scenes.at(-1)?.visual, "summary");
  assert.ok(plan.omissions.length > 0);
  assert.equal(validatePlan(plan, { snapshot }).valid, true);
});

test("collectSymbols extracts declared names from added lines", () => {
  const files = parseUnifiedDiff(
    [
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -0,0 +1,3 @@",
      "+export function alpha() {}",
      "+export const beta = 1;",
      "+class Gamma {}",
      "",
    ].join("\n"),
  );

  const [file] = files;
  assert.ok(file);
  assert.deepEqual(collectSymbols(file.hunks, "+"), ["alpha", "beta", "Gamma"]);
});
