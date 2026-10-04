/**
 * Validation for the narrate path (Phase 4 §5).
 *
 * Two layers:
 * 1. `validatePlan(plan, { snapshot, requireNarrationAudio: true })` — schema + source
 *    references + the requirement that every scene has an audio path and a positive duration.
 * 2. **Audio layer** — each clip exists, is non-empty, decodes, and its measured duration
 *    matches the recorded `narrationDurationMs` within a tolerance.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  validatePlan,
  type ValidationIssue,
} from "../analysis/validatePlan.ts";
import {
  captureSourceSnapshot,
  snapshotFromContents,
  type SourceSnapshot,
} from "../analysis/sourceSnapshot.ts";
import { relativePathError } from "../planning/paths.ts";
import type { ExplainerPlan } from "../planning/types.ts";
import { measureAudioDurationMs } from "./duration.ts";

/** Allowed difference between a clip's measured duration and the recorded value. */
export const DEFAULT_DURATION_TOLERANCE_MS = 100;

export interface NarrationValidationIssue {
  path: string;
  message: string;
}

export interface NarrateValidationResult {
  valid: boolean;
  planErrors: ValidationIssue[];
  audioErrors: NarrationValidationIssue[];
}

/**
 * Rebuilds a source snapshot for the files a plan references, preferring the committed
 * branch content (`git show HEAD:<path>`) and falling back to the working tree. Used to run
 * `validatePlan` in the narrate path without the planning stage's live snapshot.
 */
export async function capturePlanSnapshot(
  plan: ExplainerPlan,
  repositoryRoot: string,
): Promise<SourceSnapshot> {
  const files = new Set<string>();
  for (const scene of plan.scenes) {
    for (const location of scene.sourceLocations ?? []) {
      if (typeof location.file === "string" && location.file.trim() !== "") {
        files.add(location.file);
      }
    }
  }

  const contents: Record<string, string> = {};
  const list = [...files];
  if (list.length > 0) {
    const branch = await captureSourceSnapshot(
      repositoryRoot,
      list.map((file) => ({ path: file, source: "branch" as const })),
    );
    const missing: string[] = [];
    for (const file of list) {
      const lines = branch.lines(file);
      if (lines !== null) contents[file] = lines.join("\n");
      else missing.push(file);
    }

    if (missing.length > 0) {
      const working = await captureSourceSnapshot(
        repositoryRoot,
        missing.map((file) => ({
          path: file,
          source: "working-tree" as const,
        })),
      );
      for (const file of missing) {
        const lines = working.lines(file);
        if (lines !== null) contents[file] = lines.join("\n");
      }
    }
  }

  return snapshotFromContents(contents);
}

export interface ValidateNarratedPlanOptions {
  plan: ExplainerPlan;
  repositoryRoot: string;
  /** Pre-captured snapshot; captured from the plan when omitted. */
  snapshot?: SourceSnapshot;
  toleranceMs?: number;
  /** Injected for tests; defaults to reading the clip from disk. */
  readClip?: (absolutePath: string) => Promise<Uint8Array>;
  /** Injected for tests; defaults to WAV-header/FFprobe measurement. */
  measureDuration?: (filePath: string, bytes: Uint8Array) => Promise<number>;
}

/** Validates the plan and every narration clip. Returns all problems, never throws. */
export async function validateNarratedPlan(
  options: ValidateNarratedPlanOptions,
): Promise<NarrateValidationResult> {
  const snapshot =
    options.snapshot ??
    (await capturePlanSnapshot(options.plan, options.repositoryRoot));

  const planResult = validatePlan(options.plan, {
    snapshot,
    requireNarrationAudio: true,
  });

  const tolerance = options.toleranceMs ?? DEFAULT_DURATION_TOLERANCE_MS;
  const readClip =
    options.readClip ??
    (async (absolutePath: string) =>
      new Uint8Array(await readFile(absolutePath)));
  const measure =
    options.measureDuration ??
    ((filePath: string, bytes: Uint8Array) =>
      measureAudioDurationMs(filePath, { bytes }));

  const audioErrors: NarrationValidationIssue[] = [];

  for (const [index, scene] of options.plan.scenes.entries()) {
    const fieldPath = `scenes[${index}].narrationAudioPath`;
    const audioPath = scene.narrationAudioPath;
    if (typeof audioPath !== "string" || audioPath.trim() === "") {
      continue; // Already reported by validatePlan.
    }

    const pathError = relativePathError(audioPath);
    if (pathError !== null) {
      audioErrors.push({ path: fieldPath, message: pathError });
      continue;
    }

    const absolutePath = path.join(
      options.repositoryRoot,
      ...audioPath.split("/"),
    );

    let bytes: Uint8Array;
    try {
      const info = await stat(absolutePath);
      if (!info.isFile() || info.size === 0) {
        audioErrors.push({
          path: fieldPath,
          message: `narration clip is empty: ${audioPath}`,
        });
        continue;
      }
      bytes = await readClip(absolutePath);
    } catch {
      audioErrors.push({
        path: fieldPath,
        message: `narration clip not found: ${audioPath}`,
      });
      continue;
    }

    if (bytes.byteLength === 0) {
      audioErrors.push({
        path: fieldPath,
        message: `narration clip is empty: ${audioPath}`,
      });
      continue;
    }

    let measuredMs: number;
    try {
      measuredMs = await measure(absolutePath, bytes);
    } catch (error) {
      audioErrors.push({
        path: fieldPath,
        message: `narration clip could not be decoded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      continue;
    }

    const recorded = scene.narrationDurationMs;
    if (
      typeof recorded === "number" &&
      Math.abs(measuredMs - recorded) > tolerance
    ) {
      audioErrors.push({
        path: `scenes[${index}].narrationDurationMs`,
        message: `clip duration ${measuredMs} ms does not match the recorded ${recorded} ms (tolerance ${tolerance} ms).`,
      });
    }
  }

  return {
    valid: planResult.valid && audioErrors.length === 0,
    planErrors: planResult.errors,
    audioErrors,
  };
}
