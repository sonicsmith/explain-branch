/**
 * Deterministic scene-timeline model (Phase 4 §3).
 *
 * Timing comes from each scene's measured narration duration:
 *
 *   `sceneMs = leadInMs + narrationDurationMs + tailMs` (plus `gapMs` for scenes after the
 *   first), clamped to `minSceneMs`.
 *
 * Scenes without narration fall back to Phase 3's fixed `secondsPerScene`.
 *
 * **Rounding rule (single rule, applied per scene):** `frames = ceil(sceneMs / 1000 	* fps)`,
 * with a minimum of 1. `ceil` guarantees a scene is never shorter than its narration (no
 * cut-off), and the composition's `durationInFrames` is the **sum** of the scene frames, so
 * `sum(sceneFrames) === durationInFrames` holds exactly.
 */
import { NarrationError } from "../narration/provider.ts";
import type { ExplainerPlan } from "../planning/types.ts";

export interface TimelineOptions {
  fps: number;
  /** Fallback scene length for scenes without narration (Phase 3 behaviour), in seconds. */
  secondsPerScene: number;
  /** Visual lead-in before narration starts, in ms. */
  leadInMs: number;
  /** Visual hold after narration ends, in ms. */
  tailMs: number;
  /** Extra spacing folded into every scene after the first, in ms. */
  gapMs: number;
  /** Minimum length for any scene, in ms. */
  minSceneMs: number;
}

export const DEFAULT_TIMELINE_OPTIONS: Omit<
  TimelineOptions,
  "fps" | "secondsPerScene"
> = {
  leadInMs: 500,
  tailMs: 750,
  gapMs: 250,
  minSceneMs: 2000,
};

export interface SceneTiming {
  sceneId: string;
  /** First frame of the scene within the composition. */
  fromFrame: number;
  durationInFrames: number;
  /** First frame of the scene converted back to ms. */
  startMs: number;
  /** Scene length in ms used to derive `durationInFrames`. */
  durationMs: number;
  /** Narration duration in ms, or `null` when the scene is silent. */
  narrationMs: number | null;
  /** Offset within the scene, in frames, where narration playback begins (the lead-in). */
  narrationStartFrame: number;
  narrated: boolean;
}

export interface Timeline {
  fps: number;
  scenes: SceneTiming[];
  /** Equal to `sum(scene.durationInFrames)`. */
  durationInFrames: number;
  durationMs: number;
}

function roundFrames(durationMs: number, fps: number): number {
  return Math.max(1, Math.ceil((durationMs / 1000) * fps));
}

export function buildTimeline(
  plan: ExplainerPlan,
  options: TimelineOptions,
): Timeline {
  if (!Number.isFinite(options.fps) || options.fps <= 0) {
    throw new NarrationError(
      `fps must be a positive number, got ${options.fps}.`,
    );
  }

  let fromFrame = 0;
  const scenes: SceneTiming[] = [];

  plan.scenes.forEach((scene, index) => {
    const narrationMs =
      typeof scene.narrationDurationMs === "number" &&
      scene.narrationDurationMs > 0
        ? Math.round(scene.narrationDurationMs)
        : null;

    const gapMs = index > 0 ? options.gapMs : 0;
    const rawMs =
      narrationMs !== null
        ? options.leadInMs + narrationMs + options.tailMs + gapMs
        : options.secondsPerScene * 1000;
    const durationMs = Math.max(rawMs, options.minSceneMs);

    // Structural guarantee: the scene lasts at least as long as the clip plus its tail.
    if (narrationMs !== null && durationMs < narrationMs + options.tailMs) {
      throw new NarrationError(
        `Scene "${scene.id}" would be ${durationMs} ms, shorter than its ${narrationMs} ms narration plus a ${options.tailMs} ms tail.`,
      );
    }

    const durationInFrames = roundFrames(durationMs, options.fps);
    scenes.push({
      sceneId: scene.id,
      fromFrame,
      durationInFrames,
      startMs: Math.round((fromFrame / options.fps) * 1000),
      durationMs: Math.round(durationMs),
      narrationMs,
      narrationStartFrame:
        narrationMs !== null
          ? Math.round((options.leadInMs / 1000) * options.fps)
          : 0,
      narrated: narrationMs !== null,
    });
    fromFrame += durationInFrames;
  });

  const timeline: Timeline = {
    fps: options.fps,
    scenes,
    durationInFrames: fromFrame,
    durationMs: Math.round((fromFrame / options.fps) * 1000),
  };
  assertTimelineConsistent(timeline);
  return timeline;
}

/** Returns consistency problems, or an empty array when the timeline is valid. */
export function timelineIssues(timeline: Timeline): string[] {
  const issues: string[] = [];
  const sum = timeline.scenes.reduce(
    (total, scene) => total + scene.durationInFrames,
    0,
  );
  if (sum !== timeline.durationInFrames) {
    issues.push(
      `sum(sceneFrames)=${sum} does not equal durationInFrames=${timeline.durationInFrames}`,
    );
  }
  for (const scene of timeline.scenes) {
    if (
      scene.narrated &&
      scene.narrationMs !== null &&
      scene.durationMs < scene.narrationMs
    ) {
      issues.push(
        `scene "${scene.sceneId}" (${scene.durationMs} ms) is shorter than its narration (${scene.narrationMs} ms)`,
      );
    }
  }
  return issues;
}

/** Throws when the timeline is internally inconsistent. */
export function assertTimelineConsistent(timeline: Timeline): void {
  const issues = timelineIssues(timeline);
  if (issues.length > 0) {
    throw new NarrationError(
      `Inconsistent timeline:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`,
    );
  }
}
