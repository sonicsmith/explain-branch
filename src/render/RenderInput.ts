import type { ExplainerPlan } from "../planning/types.ts";
import {
  buildTimeline,
  DEFAULT_TIMELINE_OPTIONS,
  type Timeline,
  type TimelineOptions,
} from "./timeline.ts";

export interface RenderOptions {
  /** Fallback scene length for scenes without narration, in seconds. */
  secondsPerScene?: number;
  fps?: number;
  width?: number;
  height?: number;
  /**
   * Whether to burn caption text at the bottom of each scene. Off by default: the narration
   * carries the explanation, so the video keeps the full frame for the code.
   */
  showCaptions?: boolean;
  /** Visual lead-in before narration starts, in ms. */
  leadInMs?: number;
  /** Visual hold after narration ends, in ms. */
  tailMs?: number;
  /** Extra spacing folded into scenes after the first, in ms. */
  gapMs?: number;
  /** Minimum length for any scene, in ms. */
  minSceneMs?: number;
  /**
   * Optional URL prefix for narration clips. When set, clips are referenced as
   * `<base>/<narrationAudioPath>`; otherwise they resolve through `staticFile()` against
   * the render's public directory.
   */
  audioBaseUrl?: string;
}

/**
 * Everything the renderer needs, fully serializable so Remotion can pass it as `--props`.
 * `sources` holds the captured file contents, so the video shows real code without the
 * renderer touching the repository (plan §9).
 *
 * Declared as a type alias (not an interface) so it satisfies Remotion's
 * `Record<string, unknown>` constraint on composition props.
 */
export type RenderInput = {
  plan: ExplainerPlan;
  /** Repository-relative path -> full file content. */
  sources: Record<string, string>;
  options?: RenderOptions;
};

export const DEFAULT_RENDER_OPTIONS = {
  secondsPerScene: 8,
  fps: 30,
  width: 1920,
  height: 1080,
  showCaptions: false,
  ...DEFAULT_TIMELINE_OPTIONS,
} as const;

export interface ResolvedRenderOptions {
  secondsPerScene: number;
  fps: number;
  width: number;
  height: number;
  showCaptions: boolean;
  leadInMs: number;
  tailMs: number;
  gapMs: number;
  minSceneMs: number;
  audioBaseUrl?: string;
}

export function resolveRenderOptions(
  options: RenderOptions = {},
): ResolvedRenderOptions {
  return {
    secondsPerScene:
      options.secondsPerScene ?? DEFAULT_RENDER_OPTIONS.secondsPerScene,
    fps: options.fps ?? DEFAULT_RENDER_OPTIONS.fps,
    width: options.width ?? DEFAULT_RENDER_OPTIONS.width,
    height: options.height ?? DEFAULT_RENDER_OPTIONS.height,
    showCaptions: options.showCaptions ?? DEFAULT_RENDER_OPTIONS.showCaptions,
    leadInMs: options.leadInMs ?? DEFAULT_RENDER_OPTIONS.leadInMs,
    tailMs: options.tailMs ?? DEFAULT_RENDER_OPTIONS.tailMs,
    gapMs: options.gapMs ?? DEFAULT_RENDER_OPTIONS.gapMs,
    minSceneMs: options.minSceneMs ?? DEFAULT_RENDER_OPTIONS.minSceneMs,
    ...(options.audioBaseUrl !== undefined
      ? { audioBaseUrl: options.audioBaseUrl }
      : {}),
  };
}

/** Assembles the timeline options from the render options. */
export function resolveTimelineOptions(input: RenderInput): TimelineOptions {
  const options = resolveRenderOptions(input.options);
  return {
    fps: options.fps,
    secondsPerScene: options.secondsPerScene,
    leadInMs: options.leadInMs,
    tailMs: options.tailMs,
    gapMs: options.gapMs,
    minSceneMs: options.minSceneMs,
  };
}

export function countScenes(input: RenderInput): number {
  return Math.max(1, input.plan?.scenes?.length ?? 1);
}

/** Builds the narration-driven timeline for a render input. */
export function buildRenderTimeline(input: RenderInput): Timeline {
  const scenes = input.plan?.scenes ?? [];
  return buildTimeline(
    { ...input.plan, scenes },
    resolveTimelineOptions(input),
  );
}

/** Composition length: the sum of the per-scene frame lengths (see timeline.ts). */
export function totalDurationInFrames(input: RenderInput): number {
  return Math.max(1, buildRenderTimeline(input).durationInFrames);
}
