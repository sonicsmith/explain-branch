/**
 * Author stage: turn a **scaffold** plan into an authored plan by filling in each scene's
 * title, purpose, step narration, and (for the summary) narration text from an
 * {@link AuthorProvider}.
 *
 * The scaffold owns the deterministic structure — scene grouping, source locations, and
 * step line ranges — and this stage only writes the words. Keeping the ranges untouched
 * means an authored plan always validates against the same source as its scaffold, so a
 * model can never point a highlight at the wrong lines.
 */
import type { SourceSnapshot } from "../analysis/sourceSnapshot.ts";
import {
  sceneNarrationText,
  type ExplainerPlan,
  type ExplainerScene,
  type SceneStep,
} from "../planning/types.ts";
import type {
  AuthorProvider,
  AuthorRequest,
  AuthorSceneRequest,
  AuthoredScene,
} from "./provider.ts";
import { AuthorError } from "./types.ts";

export interface AuthorPlanOptions {
  plan: ExplainerPlan;
  snapshot: SourceSnapshot;
  provider: AuthorProvider;
  model: string;
}

export interface AuthorPlanResult {
  plan: ExplainerPlan;
  request: AuthorRequest;
}

/** Builds the source excerpts for a scene from every location it references. */
function buildExcerpts(
  scene: ExplainerScene,
  snapshot: SourceSnapshot,
): AuthorSceneRequest["excerpts"] {
  const excerpts: AuthorSceneRequest["excerpts"] = [];
  for (const location of scene.sourceLocations ?? []) {
    const lines = snapshot.lines(location.file);
    if (lines === null) continue;
    const start = Math.max(1, location.startLine);
    const end = Math.min(lines.length, Math.max(start, location.endLine));
    excerpts.push({
      file: location.file,
      startLine: start,
      endLine: end,
      lines: lines.slice(start - 1, end),
    });
  }
  return excerpts;
}

function buildSceneRequest(
  scene: ExplainerScene,
  snapshot: SourceSnapshot,
): AuthorSceneRequest {
  return {
    id: scene.id,
    visual: scene.visual,
    title: scene.title,
    purpose: scene.purpose,
    changes: scene.changes ?? [],
    excerpts: buildExcerpts(scene, snapshot),
    steps: (scene.steps ?? []).map((step) => ({
      file: step.file,
      startLine: step.startLine,
      endLine: step.endLine,
    })),
  };
}

/** Assembles the provider request from the scaffold plan and its captured source. */
export function buildAuthorRequest(options: AuthorPlanOptions): AuthorRequest {
  const { plan, snapshot, model } = options;
  return {
    model,
    planTitle: plan.title,
    repositoryName: plan.repositoryName,
    branchName: plan.branchName,
    baseRef: plan.baseRef,
    caveats: plan.caveats,
    omissions: plan.omissions,
    scenes: plan.scenes.map((scene) => buildSceneRequest(scene, snapshot)),
  };
}

function indexAuthored(
  authored: readonly AuthoredScene[],
): Map<string, AuthoredScene> {
  const map = new Map<string, AuthoredScene>();
  for (const scene of authored) {
    if (typeof scene?.id === "string") map.set(scene.id, scene);
  }
  return map;
}

function requireText(value: unknown, what: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "")
    throw new AuthorError(`the authoring model returned no ${what}.`);
  return text;
}

/**
 * Merges the authored text into a copy of the scaffold. Structural fields (ids, visuals,
 * source locations, step ranges, changes) are preserved exactly; only the words change.
 * Throws {@link AuthorError} when a scene is missing or a step count does not match, so a
 * partial or malformed response fails loudly instead of rendering a half-empty plan.
 */
export function applyAuthoredScenes(
  plan: ExplainerPlan,
  authored: readonly AuthoredScene[],
): ExplainerPlan {
  const byId = indexAuthored(authored);

  const scenes: ExplainerScene[] = plan.scenes.map((scene) => {
    const result = byId.get(scene.id);
    if (result === undefined) {
      throw new AuthorError(
        `the authoring model did not return scene "${scene.id}".`,
      );
    }

    const scaffoldSteps = scene.steps ?? [];
    const title =
      typeof result.title === "string" && result.title.trim() !== ""
        ? result.title.trim()
        : scene.title;
    const purpose =
      typeof result.purpose === "string" && result.purpose.trim() !== ""
        ? result.purpose.trim()
        : scene.purpose;

    if (scaffoldSteps.length > 0) {
      const authoredSteps = Array.isArray(result.steps) ? result.steps : [];
      if (authoredSteps.length !== scaffoldSteps.length) {
        throw new AuthorError(
          `scene "${scene.id}" has ${scaffoldSteps.length} step(s) but the authoring model returned ${authoredSteps.length}.`,
        );
      }
      const steps: SceneStep[] = scaffoldSteps.map((step, index) => ({
        ...step,
        narration: requireText(
          authoredSteps[index],
          `narration for step ${index + 1} of scene "${scene.id}"`,
        ),
      }));
      const withSteps: ExplainerScene = { ...scene, title, purpose, steps };
      return { ...withSteps, narrationText: sceneNarrationText(withSteps) };
    }

    const narration = requireText(
      result.narration,
      `narration for scene "${scene.id}"`,
    );
    return { ...scene, title, purpose, narrationText: narration };
  });

  return { ...plan, scenes };
}

/** Runs the author step: builds the request, calls the provider, and merges the result. */
export async function authorPlan(
  options: AuthorPlanOptions,
): Promise<AuthorPlanResult> {
  const request = buildAuthorRequest(options);
  const authored = await options.provider.author(request);
  return { plan: applyAuthoredScenes(options.plan, authored), request };
}
