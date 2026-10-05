import test from "node:test";
import assert from "node:assert/strict";
import { buildChangeInventory } from "../../src/analysis/buildChangeInventory.ts";
import { validatePlan } from "../../src/analysis/validatePlan.ts";
import { buildPlanScaffold } from "../../src/planning/buildPlan.ts";
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

test("produces a valid scaffold with a closing summary and no narration", async (t) => {
  const repo = await makeFixtureRepo();
  t.after(() => repo.cleanup());

  const inventory = await buildChangeInventory({
    repoPath: repo.dir,
    base: "main",
  });
  const { plan, snapshot } = await buildPlanScaffold({
    repositoryRoot: repo.dir,
    inventory,
    generatedAt: GENERATED_AT,
  });

  // The scaffold is validated without narration: the host agent authors that afterwards.
  const validation = validatePlan(plan, {
    snapshot,
    requireNarration: false,
  });
  assert.equal(
    validation.valid,
    true,
    JSON.stringify(validation.errors, null, 2),
  );

  assert.equal(plan.branchName, "feature");
  assert.equal(plan.baseRef, "main");
  assert.equal(plan.generatedAt, GENERATED_AT);
  assert.equal(plan.repositoryName, repo.dir.split("/").pop());

  // Narration is never invented by the planner.
  assert.ok(plan.scenes.every((scene) => scene.narrationText === ""));

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

test("suggests walkthrough steps inside the scene's source locations", async (t) => {
  const repo = await makeFixtureRepo();
  t.after(() => repo.cleanup());

  const inventory = await buildChangeInventory({
    repoPath: repo.dir,
    base: "main",
  });
  const { plan, snapshot } = await buildPlanScaffold({
    repositoryRoot: repo.dir,
    inventory,
    generatedAt: GENERATED_AT,
  });

  const stepped = plan.scenes.filter((scene) => (scene.steps?.length ?? 0) > 0);
  assert.ok(stepped.length > 0, "expected at least one stepped scene");

  for (const scene of stepped) {
    for (const step of scene.steps ?? []) {
      assert.equal(step.narration, "");
      assert.ok(
        scene.sourceLocations.some(
          (location) =>
            location.file === step.file &&
            location.startLine <= step.startLine &&
            step.endLine <= location.endLine,
        ),
        `step ${step.file}:${step.startLine}-${step.endLine} must sit inside a source location`,
      );
    }
  }

  assert.equal(
    validatePlan(plan, { snapshot, requireNarration: false }).valid,
    true,
  );
});

test("groups related files into one scene rather than one scene per file", async (t) => {
  const repo = await makeFixtureRepo();
  t.after(() => repo.cleanup());

  const inventory = await buildChangeInventory({
    repoPath: repo.dir,
    base: "main",
  });
  const { plan } = await buildPlanScaffold({
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

test("lists generated files as omissions", async (t) => {
  const repo = await makeFixtureRepo();
  t.after(() => repo.cleanup());

  const inventory = await buildChangeInventory({
    repoPath: repo.dir,
    base: "main",
  });
  const { plan } = await buildPlanScaffold({
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
  const { plan } = await buildPlanScaffold({
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
  const first = await buildPlanScaffold({
    repositoryRoot: repo.dir,
    inventory,
    generatedAt: GENERATED_AT,
  });
  const second = await buildPlanScaffold({
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
  const { plan, snapshot } = await buildPlanScaffold({
    repositoryRoot: repo.dir,
    inventory,
    maxScenes: 2,
    generatedAt: GENERATED_AT,
  });

  assert.equal(plan.scenes.length, 2);
  assert.equal(plan.scenes.at(-1)?.visual, "summary");
  assert.ok(plan.omissions.length > 0);
  assert.equal(
    validatePlan(plan, { snapshot, requireNarration: false }).valid,
    true,
  );
});

test("each scene carries a self-contained change list", async (t) => {
  const repo = await makeFixtureRepo();
  t.after(() => repo.cleanup());

  const inventory = await buildChangeInventory({
    repoPath: repo.dir,
    base: "main",
  });
  const { plan, snapshot } = await buildPlanScaffold({
    repositoryRoot: repo.dir,
    inventory,
    generatedAt: GENERATED_AT,
  });

  assert.equal(
    validatePlan(plan, { snapshot, requireNarration: false }).valid,
    true,
  );

  const codeScene = plan.scenes.find(
    (scene) => scene.visual === "code-walkthrough",
  );
  assert.ok(codeScene?.changes && codeScene.changes.length > 0);
  assert.ok(codeScene.changes.every((change) => change.path.length > 0));

  const deleted = plan.scenes
    .flatMap((scene) => scene.changes ?? [])
    .find((change) => change.path === "src/legacy.ts");
  assert.equal(deleted?.changeType, "deleted");
});
