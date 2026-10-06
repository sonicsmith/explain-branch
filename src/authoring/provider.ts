/**
 * Authoring provider abstraction.
 *
 * Keeping the pipeline behind this interface means the author stage can be tested offline
 * with a fake provider, and the OpenAI SDK import stays isolated in
 * {@link ./openaiAuthorProvider.ts}.
 */
import type {
  PlanOmission,
  SceneChange,
  SceneVisual,
} from "../planning/types.ts";

/** A contiguous slice of source (with 1-based line numbering starting at `startLine`). */
export interface SourceExcerpt {
  file: string;
  startLine: number;
  endLine: number;
  /** The source lines, one per element, in order. */
  lines: string[];
}

/** A scaffold step the author must narrate (line range preserved from the scaffold). */
export interface AuthorStepRequest {
  file: string;
  startLine: number;
  endLine: number;
}

/** One scene to author: its identity, the changed files, and the source to read. */
export interface AuthorSceneRequest {
  id: string;
  visual: SceneVisual;
  /** The scaffold's working title, offered as a starting point. */
  title: string;
  /** The scaffold's purpose line, offered as a starting point. */
  purpose: string;
  changes: SceneChange[];
  /** Source for every location the scene references. */
  excerpts: SourceExcerpt[];
  /** Steps to narrate, in render order (empty for the summary scene). */
  steps: AuthorStepRequest[];
}

/** Everything the author needs to write the narration for a scaffold plan. */
export interface AuthorRequest {
  model: string;
  planTitle: string;
  repositoryName: string;
  branchName: string;
  baseRef: string;
  caveats: string[];
  omissions: PlanOmission[];
  scenes: AuthorSceneRequest[];
}

/** The authored narration for a single scene. */
export interface AuthoredScene {
  id: string;
  title: string;
  purpose: string;
  /** Narration for a scene without steps (the summary); empty for stepped scenes. */
  narration: string;
  /** One narration per scaffold step, in order (empty for a scene without steps). */
  steps: string[];
}

/** A narration backend. Implementations return one authored scene per requested scene. */
export interface AuthorProvider {
  author(request: AuthorRequest): Promise<AuthoredScene[]>;
}
