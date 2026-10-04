/**
 * Pipeline stage functions (Phase 5 §1).
 *
 * The four stages — inspect → plan → narrate → render — are factored out of their CLIs into
 * these callable functions so both the individual stage CLIs (`src/cli/*.ts`) and the
 * end-to-end orchestrator (`src/cli/explainBranchVideo.ts`) run the *same* code. No stage
 * duplicates pipeline logic, and every stage stays independently runnable.
 *
 * All stages are read-only with respect to tracked source: the only writes are the artifacts
 * they own (plan JSON, audio clips, `render-input.json`, and the output MP4).
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildChangeInventory,
  type ChangeInventory,
} from "../analysis/buildChangeInventory.ts";
import {
  validatePlan,
  type ValidationIssue,
} from "../analysis/validatePlan.ts";
import type { SourceSnapshot } from "../analysis/sourceSnapshot.ts";
import { buildPlan } from "../planning/buildPlan.ts";
import type { ExplainerPlan } from "../planning/types.ts";
import type { RenderOptions } from "../render/RenderInput.ts";
import type { RenderInput } from "../render/RenderInput.ts";
import { resolveOutputPath } from "../render/outputPath.ts";
import {
  NarrationConfigError,
  resolveNarrationConfig,
  type NarrationConfigOverrides,
} from "../narration/config.ts";
import { readOpenAiApiKey } from "../narration/credentials.ts";
import type { FFprobeRunner } from "../narration/duration.ts";
import type { CostEstimate } from "../narration/estimate.ts";
import {
  narratePlan,
  type NarratedClip,
  type NarrationProgressEvent,
} from "../narration/narratePlan.ts";
import type { SpeechProvider } from "../narration/provider.ts";
import {
  redactPlanNarration,
  type RedactPlanResult,
} from "../narration/redact.ts";
import type { RetryHooks, RetryPolicy } from "../narration/retry.ts";
import type { NarrationConfig } from "../narration/types.ts";
import { capturePlanSnapshot } from "../narration/validateNarration.ts";

export { NarrationConfigError };
export { BaseResolutionError } from "../git/inspectBranch.ts";

/** Plugin/repository root, resolved from this module's location (`src/pipeline/`). */
export const PLUGIN_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REMOTION_CLI = path.join(
  PLUGIN_ROOT,
  "node_modules",
  "@remotion",
  "cli",
  "remotion-cli.js",
);
const DEFAULT_ENTRY_POINT = path.join(PLUGIN_ROOT, "src", "render", "index.ts");
const DEFAULT_COMPOSITION_ID = "ExplainBranch";

// ---------------------------------------------------------------------------------------
// Shared errors and run-directory helpers
// ---------------------------------------------------------------------------------------

/** Raised when the chosen run directory would fall outside the repository. */
export class RunDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunDirectoryError";
  }
}

/** Raised by {@link runPlan} when the generated plan fails validation. */
export class PlanValidationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super("The generated plan failed validation.");
    this.name = "PlanValidationError";
    this.issues = issues;
  }
}

export interface ResolvedRunDir {
  runId: string;
  /** Absolute run directory (e.g. `<repo>/artifacts/<run-id>`). */
  runDir: string;
  /** Repository-relative POSIX run directory recorded in the plan. */
  relativeRunDir: string;
}

export function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/** Turns an arbitrary branch/name into a filesystem-safe run id, or `null` when empty. */
export function sanitizeRunId(value: string | null | undefined): string | null {
  const safe = (value ?? "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return safe === "" ? null : safe;
}

/**
 * Resolves the single run directory shared by every stage, defaulting to
 * `artifacts/<run-id>` (run id derived from the branch name). Throws when the directory is
 * not inside the repository, so plan audio paths stay repository-relative.
 */
export function resolveRunDir(options: {
  repositoryRoot: string;
  runId?: string;
  runDir?: string;
  branchName?: string | null;
}): ResolvedRunDir {
  const runId = options.runId ?? sanitizeRunId(options.branchName) ?? "run";
  const runDir =
    options.runDir !== undefined
      ? path.resolve(options.repositoryRoot, options.runDir)
      : path.join(options.repositoryRoot, "artifacts", runId);

  const relativeRunDir = toPosix(path.relative(options.repositoryRoot, runDir));
  if (
    relativeRunDir === "" ||
    relativeRunDir === "." ||
    relativeRunDir === ".." ||
    relativeRunDir.startsWith("../")
  ) {
    throw new RunDirectoryError(
      "The run directory must be inside the repository so plan audio paths stay repository-relative.",
    );
  }
  return { runId, runDir, relativeRunDir };
}

// ---------------------------------------------------------------------------------------
// Stage 1 — inspect
// ---------------------------------------------------------------------------------------

export interface InspectStageOptions {
  repoPath?: string;
  base?: string;
  includeWorkingTree?: boolean;
  configuredBase?: string | null;
}

/** Reads the current branch's change inventory. Read-only. */
export function runInspect(
  options: InspectStageOptions = {},
): Promise<ChangeInventory> {
  return buildChangeInventory(options);
}

// ---------------------------------------------------------------------------------------
// Stage 2 — plan
// ---------------------------------------------------------------------------------------

export interface PlanStageOptions extends InspectStageOptions {
  /** Total scenes including the closing summary. Defaults to 5. */
  maxScenes?: number;
  /** Overrides the generation timestamp (used for deterministic tests). */
  generatedAt?: string;
  /** Reuse an inventory already built by {@link runInspect}. */
  inventory?: ChangeInventory;
}

export interface PlanStageResult {
  inventory: ChangeInventory;
  plan: ExplainerPlan;
  snapshot: SourceSnapshot;
}

/**
 * Builds and validates a scene plan. Accepts a pre-built inventory so the orchestrator does
 * not inspect the repository twice.
 */
export async function runPlan(
  options: PlanStageOptions,
): Promise<PlanStageResult> {
  const inventory = options.inventory ?? (await runInspect(options));
  const { plan, snapshot } = await buildPlan({
    repositoryRoot: inventory.repositoryRoot,
    inventory,
    ...(options.maxScenes !== undefined
      ? { maxScenes: options.maxScenes }
      : {}),
    ...(options.generatedAt !== undefined
      ? { generatedAt: options.generatedAt }
      : {}),
  });

  const validation = validatePlan(plan, { snapshot });
  if (!validation.valid) throw new PlanValidationError(validation.errors);

  return { inventory, plan, snapshot };
}

// ---------------------------------------------------------------------------------------
// Stage 3 — narrate
// ---------------------------------------------------------------------------------------

export interface NarrateStageOptions {
  repositoryRoot: string;
  plan: ExplainerPlan;
  /** Absolute run directory (holds `audio/` and, by default, `plan.json`). */
  runDir: string;
  /** Repository-relative POSIX audio directory recorded in the plan. */
  relativeAudioDir: string;
  /** Pre-resolved config; resolved from the repository + overrides when omitted. */
  config?: NarrationConfig;
  /** Raw CLI overrides used only when `config` is not supplied. */
  overrides?: NarrationConfigOverrides;
  /** Injected provider (tests / custom setups); created from credentials otherwise. */
  provider?: SpeechProvider;
  /** Provider factory used when `provider` is absent. */
  createProvider?: (config: NarrationConfig) => SpeechProvider;
  force?: boolean;
  sceneIds?: readonly string[];
  dryRun?: boolean;
  /** Where to write the enriched plan; defaults to `<runDir>/plan.json`. */
  planPath?: string;
  ffprobe?: FFprobeRunner;
  retryPolicy?: RetryPolicy;
  retryHooks?: RetryHooks;
  onProgress?: (event: NarrationProgressEvent) => void;
  log?: (message: string) => void;
}

export interface NarrateStageResult {
  plan: ExplainerPlan;
  clips: NarratedClip[];
  dryRun: boolean;
  costEstimate: CostEstimate;
  totalCharacters: number;
  config: NarrationConfig;
  redaction: RedactPlanResult;
  runDir: string;
  /** Absolute path the enriched plan was written to (absent on dry-run). */
  planPath?: string;
}

/**
 * Generates per-scene narration, measures durations, and writes the enriched plan. Redacts
 * secret-looking narration first, so secrets never reach the provider or the written plan.
 */
export async function runNarrate(
  options: NarrateStageOptions,
): Promise<NarrateStageResult> {
  const { repositoryRoot, runDir, relativeAudioDir } = options;

  const redaction = redactPlanNarration(options.plan);
  if (redaction.totalRedactions > 0 && options.log) {
    options.log(
      `Redacted ${redaction.totalRedactions} secret-looking value(s) from narration before it could be sent to the provider:`,
    );
    for (const report of redaction.reports) {
      options.log(
        `  ${report.sceneId}: ${report.redactions
          .map((entry) => `${entry.kind} x${entry.count}`)
          .join(", ")}`,
      );
    }
  }
  const plan = redaction.plan;

  const config =
    options.config ??
    (
      await resolveNarrationConfig({
        repositoryRoot,
        overrides: options.overrides ?? {},
      })
    ).config;

  const audioDir = path.join(runDir, "audio");

  let provider = options.provider;
  if (provider === undefined && !options.dryRun) {
    if (options.createProvider !== undefined) {
      provider = options.createProvider(config);
    } else {
      // Lazy import so the inspect/plan stages never load the OpenAI SDK.
      const { createOpenAiSpeechProvider } =
        await import("../narration/openaiSpeechProvider.ts");
      provider = createOpenAiSpeechProvider({ apiKey: readOpenAiApiKey() });
    }
  }

  options.log?.(
    `Narration text is derived from repository content and will be sent to the ${config.provider} TTS provider${options.dryRun ? " (dry run: nothing is sent)" : ""}.`,
  );
  options.log?.(
    `Narrating ${plan.scenes.length} scene(s) with ${config.model} (${config.voice}, ${config.format})${options.dryRun ? " [dry run]" : ""}.`,
  );

  const result = await narratePlan({
    plan,
    config,
    audioDir,
    relativeAudioDir,
    ...(provider !== undefined ? { provider } : {}),
    ...(options.force !== undefined ? { force: options.force } : {}),
    ...(options.sceneIds !== undefined && options.sceneIds.length > 0
      ? { sceneIds: options.sceneIds }
      : {}),
    ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
    ...(options.ffprobe !== undefined ? { ffprobe: options.ffprobe } : {}),
    ...(options.retryPolicy !== undefined
      ? { retryPolicy: options.retryPolicy }
      : {}),
    ...(options.retryHooks !== undefined
      ? { retryHooks: options.retryHooks }
      : {}),
    ...(options.onProgress !== undefined
      ? { onProgress: options.onProgress }
      : {}),
  });

  let planPath: string | undefined;
  if (!result.dryRun) {
    planPath = options.planPath ?? path.join(runDir, "plan.json");
    await mkdir(path.dirname(planPath), { recursive: true });
    await writeFile(
      planPath,
      `${JSON.stringify(result.plan, null, 2)}\n`,
      "utf8",
    );
  }

  return {
    ...result,
    config,
    redaction,
    runDir,
    ...(planPath !== undefined ? { planPath } : {}),
  };
}

// ---------------------------------------------------------------------------------------
// Stage 4 — render
// ---------------------------------------------------------------------------------------

export interface RenderStageOptions {
  repositoryRoot: string;
  plan: ExplainerPlan;
  /** Directory holding `render-input.json` (normally the run directory). */
  runDir: string;
  /** Desired output MP4; defaults to `<repo>/artifacts/branch-explainer.mp4`. */
  outPath?: string;
  /** Allow replacing an existing output; otherwise a timestamped name is used. */
  overwrite?: boolean;
  /** Public directory for `staticFile()` audio resolution; defaults to the repo root. */
  publicDir?: string;
  entryPoint?: string;
  compositionId?: string;
  renderOptions?: RenderOptions;
  /** Injected Remotion runner for tests; defaults to spawning the bundled CLI. */
  runner?: (args: readonly string[], cwd: string) => Promise<number>;
  log?: (message: string) => void;
}

export interface RenderStageResult {
  outPath: string;
  renderInputPath: string;
  collided: boolean;
  /** Process exit code of the Remotion render (0 on success). */
  exitCode: number;
}

/** Captures the source files a plan references into a path -> content map. */
export async function captureRenderSources(
  plan: ExplainerPlan,
  repositoryRoot: string,
): Promise<Record<string, string>> {
  const snapshot = await capturePlanSnapshot(plan, repositoryRoot);
  const sources: Record<string, string> = {};
  for (const file of snapshot.paths()) {
    const lines = snapshot.lines(file);
    if (lines !== null) sources[file] = lines.join("\n");
  }
  return sources;
}

function runRemotion(args: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [REMOTION_CLI, ...args], {
      cwd,
      // Keeps the CLI's stdout reserved for its final result: Remotion's own progress and
      // logs (including its stdout) are forwarded to our stderr.
      stdio: ["inherit", process.stderr, process.stderr],
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

/**
 * Captures the plan's sources, writes `render-input.json`, resolves a non-colliding output
 * path, and runs the Remotion renderer. Returns the renderer's exit code rather than
 * throwing, so callers can decide how to report a failed render.
 */
export async function runRender(
  options: RenderStageOptions,
): Promise<RenderStageResult> {
  const { repositoryRoot, runDir } = options;

  const sources = await captureRenderSources(options.plan, repositoryRoot);
  if (Object.keys(sources).length === 0 && options.plan.scenes.length > 0) {
    options.log?.(
      "warning: no source files were captured; code scenes will be empty.",
    );
  }

  const renderInput: RenderInput = {
    plan: options.plan,
    sources,
    options: options.renderOptions ?? {},
  };
  const renderInputPath = path.join(runDir, "render-input.json");
  await mkdir(runDir, { recursive: true });
  await writeFile(
    renderInputPath,
    `${JSON.stringify(renderInput, null, 2)}\n`,
    "utf8",
  );

  const desiredOut =
    options.outPath ??
    path.join(repositoryRoot, "artifacts", "branch-explainer.mp4");
  const { path: outPath, collided } = await resolveOutputPath(desiredOut, {
    overwrite: options.overwrite ?? false,
  });
  if (collided && options.overwrite !== true) {
    options.log?.(
      `Existing output kept; writing a new file instead: ${outPath}`,
    );
  }

  const entryPoint = options.entryPoint ?? DEFAULT_ENTRY_POINT;
  const compositionId = options.compositionId ?? DEFAULT_COMPOSITION_ID;
  const publicDir = options.publicDir ?? repositoryRoot;

  const args = [
    "render",
    entryPoint,
    compositionId,
    outPath,
    `--props=${renderInputPath}`,
    `--public-dir=${publicDir}`,
  ];
  if (options.overwrite !== true) args.push("--overwrite=false");

  options.log?.(
    `Rendering ${options.plan.scenes.length} scene(s) -> ${outPath} (props: ${renderInputPath})`,
  );

  const runner = options.runner ?? runRemotion;
  const exitCode = await runner(args, PLUGIN_ROOT);

  return { outPath, renderInputPath, collided, exitCode };
}
