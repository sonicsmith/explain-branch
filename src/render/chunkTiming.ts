/**
 * Shared frame-distribution helper (Phase 4 §4 / Phase 6 walkthrough steps).
 *
 * OpenAI TTS does not return word- or step-level timings, so a narration span is divided
 * across its parts (caption sentences, walkthrough steps) in proportion to each part's
 * character length. This is an honest approximation rather than a claim of exact alignment,
 * and using one implementation keeps captions and step highlights in lock-step.
 */

export interface FrameWindow {
  /** Frame, relative to the scene, at which the part appears. */
  fromFrame: number;
  durationInFrames: number;
}

export interface DistributeFrameWindowsOptions {
  /** Frame, relative to the scene, at which the span starts. */
  startFrame: number;
  /** Frames the span covers. */
  spanFrames: number;
}

/**
 * Distributes `spanFrames` across `weights` proportionally to their value. Boundaries are
 * rounded, kept monotonic (every window is at least one frame), and the final window ends
 * exactly at `startFrame + spanFrames` so the track matches the narration span.
 */
export function distributeFrameWindows(
  weights: readonly number[],
  options: DistributeFrameWindowsOptions,
): FrameWindow[] {
  if (weights.length === 0) return [];

  const span = Math.max(1, Math.round(options.spanFrames));
  const start = Math.max(0, Math.round(options.startFrame));
  const end = start + span;

  const safeWeights = weights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 1,
  );
  const totalWeight = safeWeights.reduce((sum, weight) => sum + weight, 0) || 1;

  const windows: FrameWindow[] = [];
  let boundary = start;
  let cumulative = 0;

  safeWeights.forEach((weight, index) => {
    cumulative += weight;
    const isLast = index === safeWeights.length - 1;
    const proportional = start + Math.round((span * cumulative) / totalWeight);
    const rawEnd = isLast ? end : proportional;
    const chunkEnd = Math.max(rawEnd, boundary + 1);

    windows.push({
      fromFrame: boundary,
      durationInFrames: chunkEnd - boundary,
    });
    boundary = chunkEnd;
  });

  return windows;
}
