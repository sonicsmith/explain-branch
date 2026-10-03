import type { ExplainerPlan } from "../planning/types.ts";

export interface RenderOptions {
  /** Silent-scene length; replaced by real narration durations in Phase 4. */
  secondsPerScene?: number;
  fps?: number;
  width?: number;
  height?: number;
  showCaptions?: boolean;
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
  showCaptions: true,
} as const;

export interface ResolvedRenderOptions {
  secondsPerScene: number;
  fps: number;
  width: number;
  height: number;
  showCaptions: boolean;
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
  };
}

export function countScenes(input: RenderInput): number {
  return Math.max(1, input.plan?.scenes?.length ?? 1);
}

export function sceneDurationInFrames(input: RenderInput): number {
  const { secondsPerScene, fps } = resolveRenderOptions(input.options);
  return Math.max(1, Math.round(secondsPerScene * fps));
}

export function totalDurationInFrames(input: RenderInput): number {
  return Math.max(1, countScenes(input) * sceneDurationInFrames(input));
}
