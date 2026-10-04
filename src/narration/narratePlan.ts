/**
 * Narration stage (Phase 4 §2): turns a validated plan into the same plan enriched with
 * per-scene `narrationAudioPath` + `narrationDurationMs`.
 *
 * Design decisions (recorded in ADR 0002, Decision 2):
 * - **One clip per scene**, so retries and re-renders are cheap and independent.
 * - **Layout:** `<audioDir>/<scene-id>.<format>` with a JSON sidecar `<clip>.json` holding
 *   the cache key and measured duration. The caller supplies the run directory
 *   (`artifacts/<run-id>/audio`).
 * - **Path recorded in the plan:** repository-relative POSIX, so the plan stays portable and
 *   the renderer resolves it against the repository root.
 * - **Cache key:** SHA-256 over `{ provider, model, voice, instructions, format, text }`.
 *   A scene is skipped when a clip with a matching sidecar already exists, so a failed render
 *   never re-bills for audio it already has.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExplainerPlan, ExplainerScene } from "../planning/types.ts";
import { estimateSpeechCost, type CostEstimate } from "./estimate.ts";
import {
  countSpeechCharacters,
  MAX_SPEECH_INPUT_CHARACTERS,
} from "./limits.ts";
import { measureAudioDurationMs, type FFprobeRunner } from "./duration.ts";
import { NarrationError, type SpeechProvider } from "./provider.ts";
import type { NarrationConfig } from "./types.ts";
import { readWavDurationMs } from "./wav.ts";

export interface NarrationCacheKeyInput {
  provider: string;
  model: string;
  voice: string;
  instructions: string | null;
  format: string;
  text: string;
}

/** Stable cache key: any change to the inputs that affect the audio invalidates it. */
export function cacheKeyFor(input: NarrationCacheKeyInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/** Sidecar metadata written next to each clip. */
export interface ClipMetadata {
  cacheKey: string;
  sceneId: string;
  format: string;
  model: string;
  voice: string;
  characters: number;
  durationMs: number;
  generatedAt: string;
}

export interface NarrationProgressEvent {
  sceneId: string;
  status: "dry-run" | "generating" | "generated" | "cached" | "skipped";
  characters?: number;
  durationMs?: number;
}

export interface NarratedClip {
  sceneId: string;
  characters: number;
  durationMs: number;
  /** Repository-relative POSIX path recorded in the plan (absent on dry-run). */
  audioPath?: string;
  absolutePath?: string;
  cached: boolean;
}

export interface NarratePlanOptions {
  plan: ExplainerPlan;
  config: NarrationConfig;
  /** Absolute directory where clips and sidecars are written. */
  audioDir: string;
  /** Repository-relative POSIX directory recorded in the plan. */
  relativeAudioDir: string;
  /** Required unless `dryRun` is set. */
  provider?: SpeechProvider;
  /** Regenerate even when a matching cached clip exists. */
  force?: boolean;
  /** Only (re)generate these scene ids; leave the rest untouched. */
  sceneIds?: readonly string[];
  dryRun?: boolean;
  /** Injected FFprobe runner used for non-WAV clips (offline tests). */
  ffprobe?: FFprobeRunner;
  /** Injected for deterministic tests. */
  now?: () => Date;
  onProgress?: (event: NarrationProgressEvent) => void;
}

export interface NarratePlanResult {
  plan: ExplainerPlan;
  clips: NarratedClip[];
  dryRun: boolean;
  costEstimate: CostEstimate;
  totalCharacters: number;
}

/** Turns a scene id into a filesystem-safe clip file name. */
export function audioFileName(sceneId: string, format: string): string {
  const safe = sceneId
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return `${safe === "" ? "scene" : safe}.${format}`;
}

function validatePlanScenes(plan: ExplainerPlan): void {
  if (!Array.isArray(plan.scenes) || plan.scenes.length === 0) {
    throw new NarrationError("The plan contains no scenes to narrate.");
  }
  const seen = new Set<string>();
  for (const scene of plan.scenes) {
    if (typeof scene.id !== "string" || scene.id.trim() === "") {
      throw new NarrationError("A scene is missing an id.");
    }
    if (seen.has(scene.id)) {
      throw new NarrationError(`Duplicate scene id "${scene.id}".`);
    }
    seen.add(scene.id);
    if (
      typeof scene.narrationText !== "string" ||
      scene.narrationText.trim() === ""
    ) {
      throw new NarrationError(`Scene "${scene.id}" has no narrationText.`);
    }
  }
}

async function readCachedClip(
  absolutePath: string,
  cacheKey: string,
): Promise<number | null> {
  try {
    const raw = await readFile(`${absolutePath}.json`, "utf8");
    const metadata = JSON.parse(raw) as Partial<ClipMetadata>;
    if (metadata.cacheKey !== cacheKey) return null;

    const info = await stat(absolutePath);
    if (!info.isFile() || info.size === 0) return null;

    if (typeof metadata.durationMs === "number" && metadata.durationMs > 0) {
      return Math.round(metadata.durationMs);
    }
    return readWavDurationMs(new Uint8Array(await readFile(absolutePath)));
  } catch {
    return null;
  }
}

/**
 * Generates (or reuses) one audio clip per scene and returns the enriched plan. Idempotent:
 * re-running with the same config skips clips whose cache key still matches.
 */
export async function narratePlan(
  options: NarratePlanOptions,
): Promise<NarratePlanResult> {
  const { plan, config, audioDir, relativeAudioDir } = options;
  const dryRun = options.dryRun === true;
  const force = options.force === true;

  validatePlanScenes(plan);

  const entries = plan.scenes.map((scene) => ({
    scene,
    characters: countSpeechCharacters(scene.narrationText),
  }));

  let totalCharacters = 0;
  for (const { scene, characters } of entries) {
    if (characters > MAX_SPEECH_INPUT_CHARACTERS) {
      throw new NarrationError(
        `Scene "${scene.id}" narration is ${characters} characters, exceeding the ` +
          `${MAX_SPEECH_INPUT_CHARACTERS}-character TTS request limit. Shorten the narration ` +
          `or split the scene; it is never truncated silently.`,
      );
    }
    totalCharacters += characters;
  }

  const costEstimate = estimateSpeechCost(config.model, totalCharacters) ?? {
    usd: 0,
    basis: `no pricing data for model "${config.model}"`,
    complete: false,
  };

  const selection =
    options.sceneIds === undefined ? null : new Set(options.sceneIds);
  if (selection !== null) {
    for (const id of selection) {
      if (!plan.scenes.some((scene) => scene.id === id)) {
        throw new NarrationError(
          `Unknown scene "${id}". Known scenes: ${plan.scenes.map((s) => s.id).join(", ")}.`,
        );
      }
    }
  }

  if (dryRun) {
    const clips: NarratedClip[] = entries.map(({ scene, characters }) => {
      options.onProgress?.({
        sceneId: scene.id,
        status: "dry-run",
        characters,
      });
      return { sceneId: scene.id, characters, durationMs: 0, cached: false };
    });
    return { plan, clips, dryRun: true, costEstimate, totalCharacters };
  }

  if (options.provider === undefined) {
    throw new NarrationError(
      "A speech provider is required unless --dry-run is set.",
    );
  }
  const provider = options.provider;
  const now = options.now ?? (() => new Date());

  await mkdir(audioDir, { recursive: true });

  const clips: NarratedClip[] = [];
  const enrichedScenes: ExplainerScene[] = [];

  for (const { scene, characters } of entries) {
    const selected = selection === null || selection.has(scene.id);
    const fileName = audioFileName(scene.id, config.format);
    const absolutePath = path.join(audioDir, fileName);
    const relativePath = path.posix.join(relativeAudioDir, fileName);
    const cacheKey = cacheKeyFor({
      provider: config.provider,
      model: config.model,
      voice: config.voice,
      instructions: config.instructions ?? null,
      format: config.format,
      text: scene.narrationText,
    });

    // Cache reuse applies to a full run. Naming specific scenes (`--scene`) is an explicit
    // request to regenerate them, so it bypasses the cache just like `--force`.
    const cachedDurationMs =
      selection === null && !force
        ? await readCachedClip(absolutePath, cacheKey)
        : null;

    if (cachedDurationMs !== null) {
      options.onProgress?.({
        sceneId: scene.id,
        status: "cached",
        characters,
        durationMs: cachedDurationMs,
      });
      enrichedScenes.push({
        ...scene,
        narrationAudioPath: relativePath,
        narrationDurationMs: cachedDurationMs,
      });
      clips.push({
        sceneId: scene.id,
        characters,
        durationMs: cachedDurationMs,
        audioPath: relativePath,
        absolutePath,
        cached: true,
      });
      continue;
    }

    if (!selected) {
      options.onProgress?.({
        sceneId: scene.id,
        status: "skipped",
        characters,
      });
      enrichedScenes.push({ ...scene });
      clips.push({
        sceneId: scene.id,
        characters,
        durationMs: scene.narrationDurationMs ?? 0,
        cached: true,
      });
      continue;
    }

    options.onProgress?.({
      sceneId: scene.id,
      status: "generating",
      characters,
    });
    const bytes = await provider.synthesize({
      text: scene.narrationText,
      model: config.model,
      voice: config.voice,
      ...(config.instructions !== undefined
        ? { instructions: config.instructions }
        : {}),
      format: config.format,
    });
    if (bytes.byteLength === 0) {
      throw new NarrationError(
        `The TTS provider returned an empty clip for scene "${scene.id}".`,
      );
    }

    await writeFile(absolutePath, bytes);
    const durationMs = await measureAudioDurationMs(absolutePath, {
      bytes,
      ...(options.ffprobe !== undefined ? { ffprobe: options.ffprobe } : {}),
    });

    const metadata: ClipMetadata = {
      cacheKey,
      sceneId: scene.id,
      format: config.format,
      model: config.model,
      voice: config.voice,
      characters,
      durationMs,
      generatedAt: now().toISOString(),
    };
    await writeFile(
      `${absolutePath}.json`,
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );

    options.onProgress?.({
      sceneId: scene.id,
      status: "generated",
      characters,
      durationMs,
    });
    enrichedScenes.push({
      ...scene,
      narrationAudioPath: relativePath,
      narrationDurationMs: durationMs,
    });
    clips.push({
      sceneId: scene.id,
      characters,
      durationMs,
      audioPath: relativePath,
      absolutePath,
      cached: false,
    });
  }

  return {
    plan: { ...plan, scenes: enrichedScenes },
    clips,
    dryRun: false,
    costEstimate,
    totalCharacters,
  };
}
