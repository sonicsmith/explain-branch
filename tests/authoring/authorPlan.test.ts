import test from "node:test";
import assert from "node:assert/strict";
import { buildChangeInventory } from "../../src/analysis/buildChangeInventory.ts";
import { validatePlan } from "../../src/analysis/validatePlan.ts";
import { buildPlanScaffold } from "../../src/planning/buildPlan.ts";
import {
  sceneNarrationText,
  type ExplainerPlan,
} from "../../src/planning/types.ts";
import type { SourceSnapshot } from "../../src/analysis/sourceSnapshot.ts";
import {
  authorPlan,
  buildAuthorRequest,
} from "../../src/authoring/authorPlan.ts";
import { createFakeAuthorProvider } from "../../src/authoring/fakeAuthorProvider.ts";
import type {
  AuthorProvider,
  AuthorRequest,
  AuthoredScene,
} from "../../src/authoring/provider.ts";
import { AuthorError } from "../../src/authoring/types.ts";
import { TempRepo } from "../helpers/tempRepo.ts";

const GENERATED_AT = "2026-01-01T00:00:00.000Z";

async function scaffoldRepo(): Promise<{
  repo: TempRepo;
  plan: ExplainerPlan;
  snapshot: SourceSnapshot;
}> {
  const repo = await TempRepo.create();
  await repo.write("src/app.ts", "export const a = 1;\n");
  await repo.commit("base");
  await repo.git(["checkout", "-b", "feature"]);
  await repo.write("src/app.ts", "export const a = 2;\nexport const b = 3;\n");
  await repo.commit("feature change");

  const inventory = await buildChangeInventory({
    repoPath: repo.dir,
    base: "main",
  });
  const { plan, snapshot } = await buildPlanScaffold({
    repositoryRoot: repo.dir,
    inventory,
    generatedAt: GENERATED_AT,
  });
  return { repo, plan, snapshot };
}

/** A provider that returns whatever it is told to, ignoring the request. */
function fixedProvider(scenes: AuthoredScene[]): AuthorProvider {
  return {
    async author(): Promise<AuthoredScene[]> {
      return scenes;
    },
  };
}

test("builds an author request with source excerpts and blank-narration steps", async (t) => {
  const { repo, plan, snapshot } = await scaffoldRepo();
  t.after(() => repo.cleanup());

  const request: AuthorRequest = buildAuthorRequest({
    plan,
    snapshot,
    provider: createFakeAuthorProvider(),
    model: "test-model",
  });

  assert.equal(request.model, "test-model");
  assert.equal(request.scenes.length, plan.scenes.length);

  const codeScene = request.scenes.find((scene) => scene.steps.length > 0);
  assert.ok(codeScene, "expected a scene with walkthrough steps");
  assert.ok(codeScene.excerpts.length > 0, "expected source excerpts");
  assert.ok(codeScene.excerpts[0]!.lines.length > 0);
});

test("fills narration from the provider, keeps structure, and validates", async (t) => {
  const { repo, plan, snapshot } = await scaffoldRepo();
  t.after(() => repo.cleanup());

  const { plan: authored } = await authorPlan({
    plan,
    snapshot,
    provider: createFakeAuthorProvider(),
    model: "test-model",
  });

  // Structural fields are preserved exactly.
  assert.deepEqual(
    authored.scenes.map((scene) => scene.id),
    plan.scenes.map((scene) => scene.id),
  );
  assert.deepEqual(
    authored.scenes.map((scene) => scene.sourceLocations),
    plan.scenes.map((scene) => scene.sourceLocations),
  );
  assert.deepEqual(
    authored.scenes.map((scene) =>
      (scene.steps ?? []).map((step) => [
        step.file,
        step.startLine,
        step.endLine,
      ]),
    ),
    plan.scenes.map((scene) =>
      (scene.steps ?? []).map((step) => [
        step.file,
        step.startLine,
        step.endLine,
      ]),
    ),
  );

  for (const scene of authored.scenes) {
    assert.ok(scene.narrationText.trim() !== "", `scene ${scene.id} narration`);
    assert.equal(scene.narrationText, sceneNarrationText(scene));
  }

  const validation = validatePlan(authored, { snapshot });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));

  // The scaffold is not mutated.
  assert.equal(plan.scenes[0]!.narrationText, "");
  assert.ok(
    (plan.scenes[0]!.steps ?? []).every((step) => step.narration === ""),
  );
});

test("rejects a response whose step count does not match the scaffold", async (t) => {
  const { repo, plan, snapshot } = await scaffoldRepo();
  t.after(() => repo.cleanup());

  const wrongSteps: AuthorProvider = {
    async author(request) {
      return request.scenes.map((scene) => ({
        id: scene.id,
        title: scene.title,
        purpose: scene.purpose,
        narration: "summary",
        steps: [...scene.steps.map(() => "x"), "extra"],
      }));
    },
  };

  await assert.rejects(
    () => authorPlan({ plan, snapshot, provider: wrongSteps, model: "m" }),
    (error: unknown) =>
      error instanceof AuthorError && /step/.test(error.message),
  );
});

test("rejects a response that is missing a scene", async (t) => {
  const { repo, plan, snapshot } = await scaffoldRepo();
  t.after(() => repo.cleanup());

  await assert.rejects(
    () =>
      authorPlan({ plan, snapshot, provider: fixedProvider([]), model: "m" }),
    (error: unknown) => error instanceof AuthorError,
  );
});

test("rejects empty narration", async (t) => {
  const { repo, plan, snapshot } = await scaffoldRepo();
  t.after(() => repo.cleanup());

  const empty = fixedProvider(
    plan.scenes.map((scene) => ({
      id: scene.id,
      title: "",
      purpose: "",
      narration: "",
      steps: (scene.steps ?? []).map(() => ""),
    })),
  );

  await assert.rejects(
    () => authorPlan({ plan, snapshot, provider: empty, model: "m" }),
    (error: unknown) => error instanceof AuthorError,
  );
});
