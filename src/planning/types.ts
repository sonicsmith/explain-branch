/**
 * Versioned scene-plan data model (plan §8). This is the stable contract between the
 * analysis/planning stages and the renderer, so keep it typed and bump
 * {@link PLAN_SCHEMA_VERSION} on breaking changes.
 */

export const PLAN_SCHEMA_VERSION = 3;

export type SceneVisual =
  | "code-walkthrough"
  | "diff"
  | "architecture"
  | "summary";

export const SCENE_VISUALS: readonly SceneVisual[] = [
  "code-walkthrough",
  "diff",
  "architecture",
  "summary",
];

export interface SourceLocation {
  /** Repository-relative path. */
  file: string;
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
}

export interface CodeHighlight {
  startLine: number;
  endLine: number;
  label?: string;
}

export interface DiagramNode {
  id: string;
  label: string;
  kind?: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramSpec {
  description: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export type SceneChangeType =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "unknown";

export const SCENE_CHANGE_TYPES: readonly SceneChangeType[] = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type-changed",
  "unknown",
];

/**
 * A changed file belonging to a scene, captured so the renderer is self-contained and
 * never needs repository access.
 */
export interface SceneChange {
  path: string;
  oldPath?: string;
  changeType: SceneChangeType;
  language: string;
  addedLines: number;
  deletedLines: number;
  isBinary: boolean;
  isGenerated: boolean;
}

/**
 * One step of a scene's code walkthrough. Each step pairs a short stretch of code (a few
 * lines) with a plain-English explanation of what those lines do. A scene plays its steps
 * in order: the highlighted range advances as its narration plays, so the viewer is walked
 * through the change a few lines at a time instead of being shown one static block.
 *
 * Steps are authored from the scaffold (by the CLI's authoring stage, or by you when you pass
 * `--plan`) — never mechanically generated. See `docs/cli.md`.
 * `SceneStep.narration`, joined in order, should make up the scene's `narrationText` so
 * captions, audio, and highlights stay aligned.
 */
export interface SceneStep {
  /** Plain-English explanation of what the highlighted lines do. */
  narration: string;
  /** Repository-relative path the step focuses on (one of the scene's sourceLocations). */
  file: string;
  /** Small 1-based, inclusive line range highlighted while this step's narration plays. */
  startLine: number;
  endLine: number;
}

export interface ExplainerScene {
  id: string;
  title: string;
  purpose: string;
  /** Full scene narration (the TTS input). When `steps` are present this should be their narrations joined. */
  narrationText: string;
  visual: SceneVisual;
  sourceLocations: SourceLocation[];
  highlights: CodeHighlight[];
  /** Ordered walkthrough steps; the renderer advances through them as narration plays. */
  steps?: SceneStep[];
  changes?: SceneChange[];
  diagramSpec?: DiagramSpec;
  narrationAudioPath?: string;
  narrationDurationMs?: number;
}

export interface PlanOmission {
  item: string;
  reason: string;
}

export interface ExplainerPlan {
  schemaVersion: number;
  title: string;
  repositoryName: string;
  branchName: string;
  baseRef: string;
  generatedAt: string;
  scenes: ExplainerScene[];
  omissions: PlanOmission[];
  caveats: string[];
}

/**
 * The narration text for a scene: the step narrations joined in order when steps are
 * present, otherwise the scene's `narrationText`. Used by the TTS/caption/report layers so
 * a stepped scene stays self-consistent even if `narrationText` drifts from the steps.
 */
export function sceneNarrationText(scene: ExplainerScene): string {
  const steps = scene.steps ?? [];
  if (steps.length === 0) return scene.narrationText ?? "";
  const joined = steps
    .map((step) => (step.narration ?? "").trim())
    .filter((text) => text !== "")
    .join(" ");
  return joined !== "" ? joined : (scene.narrationText ?? "");
}
