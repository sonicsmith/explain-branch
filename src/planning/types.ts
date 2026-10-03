/**
 * Versioned scene-plan data model (plan §8). This is the stable contract between the
 * analysis/planning stages and the renderer, so keep it typed and bump
 * {@link PLAN_SCHEMA_VERSION} on breaking changes.
 */

export const PLAN_SCHEMA_VERSION = 1;

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

export interface ExplainerScene {
  id: string;
  title: string;
  purpose: string;
  narrationText: string;
  visual: SceneVisual;
  sourceLocations: SourceLocation[];
  highlights: CodeHighlight[];
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
