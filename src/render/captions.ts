/**
 * Caption timing (Phase 4 §4).
 *
 * OpenAI TTS does not return word- or segment-level timings, so captions are chunked by
 * **sentence** and the clip's measured duration is distributed across sentences in proportion
 * to their character length. This keeps each caption on screen while it is (approximately)
 * being spoken — an honest approximation rather than a claim of exact alignment.
 *
 * Silent scenes (no measured narration) show the whole line for the scene duration instead.
 */
import type { ExplainerScene } from "../planning/types.ts";
import { sceneNarrationText } from "../planning/types.ts";
import { distributeFrameWindows } from "./chunkTiming.ts";
import { buildStepWindows } from "./steps.ts";
import type { SceneTiming } from "./timeline.ts";

export interface CaptionChunk {
  text: string;
  /** Frame, relative to the scene, at which the chunk appears. */
  fromFrame: number;
  durationInFrames: number;
}

/** Splits narration text into sentences, normalising whitespace. */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized === "") return [];

  const parts = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");

  return parts.length > 0 ? parts : [normalized];
}

export interface BuildCaptionChunksOptions {
  /** Frame, relative to the scene, at which narration starts. */
  startFrame: number;
  /** Frames the narration spans within the scene. */
  spanFrames: number;
}

/**
 * Distributes `spanFrames` across the sentences of `text` proportionally to character count.
 * Boundaries are rounded, kept monotonic, and the final chunk ends exactly at
 * `startFrame + spanFrames` so the caption track matches the audio span.
 */
export function buildCaptionChunks(
  text: string,
  options: BuildCaptionChunksOptions,
): CaptionChunk[] {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];

  const windows = distributeFrameWindows(
    sentences.map((sentence) => Array.from(sentence).length),
    { startFrame: options.startFrame, spanFrames: options.spanFrames },
  );

  return sentences.map((sentence, index) => ({
    text: sentence,
    fromFrame: windows[index]?.fromFrame ?? 0,
    durationInFrames: windows[index]?.durationInFrames ?? 1,
  }));
}

/**
 * Builds the caption track for a scene: proportional sentence chunks when the scene has a
 * measured narration duration, otherwise a single full-line chunk for the scene.
 */
export function buildSceneCaptions(
  scene: ExplainerScene,
  timing: SceneTiming | undefined,
  fps: number,
): CaptionChunk[] {
  // Stepped scenes show one caption per step, matching the step windows exactly so the
  // caption and the highlighted code always agree.
  const steps = scene.steps ?? [];
  if (steps.length > 0) {
    return buildStepWindows(scene, timing, fps)
      .filter((window) => window.narration.trim() !== "")
      .map((window) => ({
        text: window.narration.trim(),
        fromFrame: window.fromFrame,
        durationInFrames: window.durationInFrames,
      }));
  }

  const text = sceneNarrationText(scene);
  if (text.trim() === "") return [];

  if (timing !== undefined && timing.narrated && timing.narrationMs !== null) {
    const narrationFrames = Math.max(
      1,
      Math.round((timing.narrationMs / 1000) * fps),
    );
    return buildCaptionChunks(text, {
      startFrame: timing.narrationStartFrame,
      spanFrames: narrationFrames,
    });
  }

  const sceneFrames = timing?.durationInFrames ?? Math.max(1, Math.round(fps));
  return [{ text: text.trim(), fromFrame: 0, durationInFrames: sceneFrames }];
}
