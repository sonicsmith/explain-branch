/**
 * Walkthrough step timing (multi-step scenes).
 *
 * A scene's `steps` walk through the change a few lines at a time. The scene has a single
 * narration clip, so this module divides that narration span across the steps in proportion
 * to each step's narration length (see `chunkTiming.ts`). The renderer uses the resulting
 * windows to decide which step — and therefore which lines — to highlight at any frame.
 */
import type { ExplainerScene } from "../planning/types.ts";
import { distributeFrameWindows } from "./chunkTiming.ts";
import type { SceneTiming } from "./timeline.ts";

export interface StepWindow {
  stepIndex: number;
  file: string;
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
  narration: string;
  /** Frame, relative to the scene, at which this step becomes active. */
  fromFrame: number;
  durationInFrames: number;
}

/**
 * Distributes a scene's narration across its steps. With no narration timing (silent scenes)
 * the whole scene duration is used. Returns `[]` when the scene has no steps.
 */
export function buildStepWindows(
  scene: ExplainerScene,
  timing: SceneTiming | undefined,
  fps: number,
): StepWindow[] {
  const steps = scene.steps ?? [];
  if (steps.length === 0) return [];

  let startFrame = 0;
  let spanFrames: number;
  if (timing !== undefined && timing.narrated && timing.narrationMs !== null) {
    startFrame = timing.narrationStartFrame;
    spanFrames = Math.max(1, Math.round((timing.narrationMs / 1000) * fps));
  } else {
    spanFrames = timing?.durationInFrames ?? Math.max(1, Math.round(fps));
  }

  const windows = distributeFrameWindows(
    steps.map((step) => Array.from(step.narration ?? "").length),
    { startFrame, spanFrames },
  );

  return steps.map((step, index) => ({
    stepIndex: index,
    file: step.file,
    startLine: step.startLine,
    endLine: step.endLine,
    narration: step.narration ?? "",
    fromFrame: windows[index]?.fromFrame ?? startFrame,
    durationInFrames: windows[index]?.durationInFrames ?? spanFrames,
  }));
}

/**
 * The step active at `frame` (scene-relative). Clamps to the first step before the span
 * starts and to the last step after it ends, so a highlight is always shown.
 */
export function activeStep(
  windows: readonly StepWindow[],
  frame: number,
): StepWindow | null {
  if (windows.length === 0) return null;
  const first = windows[0];
  if (first !== undefined && frame < first.fromFrame) return first;
  for (const window of windows) {
    if (
      frame >= window.fromFrame &&
      frame < window.fromFrame + window.durationInFrames
    ) {
      return window;
    }
  }
  return windows[windows.length - 1] ?? null;
}
