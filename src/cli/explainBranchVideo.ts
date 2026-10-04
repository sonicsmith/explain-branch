#!/usr/bin/env node
/**
 * Phase 5 orchestrator: run the whole pipeline end to end.
 *
 * inspect → plan → narrate → render → validate, under a single run directory
 * (`artifacts/<run-id>/`). Each stage is the same callable function its standalone CLI uses
 * (`src/pipeline/stages.ts`), so behaviour never diverges.
 *
 * The run is resumable: when `<run-dir>/plan.json` already exists and validates, the narrated
 * plan is reused and only the render is repeated. `narratePlan` also skips cached clips, so a
 * failed render never re-bills for audio it already has.
 *
 * Read-only with respect to tracked source: the only writes are artifacts under the run
 * directory (and the output MP4). Failures never leave the repository changed — no stage
 * checks out, resets, stashes, commits, or writes tracked files; on failure the run directory
 * is kept so the command can be re-run to resume, and HEAD/branch are asserted unchanged.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BaseResolutionError } from "../analysis/buildChangeInventory.ts";
import {
  getBranchState,
  resolveRepositoryRoot,
} from "../git/inspectBranch.ts";
import {
  NarrationConfigError,
  resolveNarrationConfig,
  type NarrationConfigOverrides,
} from "../narration/config.ts";
import {
  CredentialRejectedError,
  MissingCredentialError,
  readOpenAiApiKey,
} from "../narration/credentials.ts";
import type { NarrationProgressEvent } from "../narration/narratePlan.ts";
import { validateNarratedPlan } from "../narration/validateNarration.ts";
import type { ExplainerPlan } from "../planning/types.ts";
import { readConfiguredMaxScenes } from "../pipeline/projectConfig.ts";
import {
  buildRunReport,
  formatReportSummary,
  verifyRenderedVideo,
  writeNarrationScript,
  writeRunReport,
} from "../pipeline/report.ts";
import {
  createPlaceholderRenderRunner,
  createPlaceholderSpeechProvider,
  fakeTtsEnabled,
  skipRenderEnabled,
} from "../pipeline/testHooks.ts";
import {
  PlanValidationError,
  resolveRunDir,
  runInspect,
  runNarrate,
  runPlan,
  runRender,
  type NarrateStageResult,
} from "../pipeline/stages.ts";

interface CliOptions {
  repoPath?: string;
  base?: string;
  includeWorkingTree: boolean;
  maxScenes?: number;
  runId?: string;
  runDir?: string;
  outPath?: string;
  force: boolean;
  overwrite: boolean;
  dryRun: boolean;
  stdout: boolean;
  overrides: NarrationConfigOverrides;
  help: boolean;
}

/** Facts captured after inspection so a failure can assert and report cleanly. */
interface RunContext {
  repositoryRoot: string;
  runDir: string;
  head: string | null;
  branch: string | null;
  /** True once a plan has been written, i.e. a re-run can resume from cached artifacts. */
  planned: boolean;
}

const HELP = `explain-branch — turn the current branch into a narrated explainer video (end to end)

Usage:
  explain-branch-video [options]

Options:
  --base <ref>             Compare against this ref (default: auto-resolved)
  --include-working-tree   Include uncommitted working-tree changes (default: false)
  --max-scenes <n>         Total scenes including the summary (default: 5, or the project config)
  --stdout                 Print the scene plan JSON to stdout and stop (no narration/render)
  --run-id <id>            Run directory name (default: the branch name)
  --run-dir <path>         Explicit run directory (default: <repo>/artifacts/<run-id>)
  --out <path>             Output MP4 (default: <repo>/artifacts/branch-explainer.mp4)
  --force                  Re-plan and regenerate even when a resume is possible
  --overwrite              Allow replacing an existing output (default: timestamped name)
  --dry-run                Plan + cost estimate only; no audio, no render
  --provider <name>        Narration provider (default: openai)
  --model <id>             TTS model (default: gpt-4o-mini-tts)
  --voice <name>           Voice (default: marin)
  --format <fmt>           Audio format: mp3|opus|aac|flac|wav|pcm (default: wav)
  --instructions <txt>     Tone/style instructions (gpt-4o-mini-tts only)
  --repo <path>            Path inside the repository (default: cwd)
  -h, --help               Show this help

Artifacts are written under the run directory: branch-plan.json, plan.json (narrated),
narration.txt, audio/<scene>.wav, render-input.json, and report.json. Narration requires
OPENAI_API_KEY.

Progress and pre-flight disclosure are written to stderr; stdout carries only the final
machine-readable result (the run report JSON; the plan JSON with --stdout; a JSON summary
with --dry-run).

Defaults can be set per repository in .explain-branch.json or package.json
(`explainBranch`): `base`, `maxScenes`, and `narration`. Precedence for narration is
CLI flag > .explain-branch.json > package.json > EXPLAIN_BRANCH_TTS_* env > built-in.

Exit codes: 0 success, 2 base/config could not be resolved, 3 plan failed validation,
4 missing/rejected credentials, the renderer's exit code on render failure, 1 other error.
On failure the kept run directory and a resume command are reported.

Narration text is derived from repository content and is sent to the configured provider.`;

function splitFlag(
  arg: string,
): [flag: string, inlineValue: string | undefined] {
  const equals = arg.indexOf("=");
  if (equals === -1) return [arg, undefined];
  return [arg.slice(0, equals), arg.slice(equals + 1)];
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    includeWorkingTree: false,
    force: false,
    overwrite: false,
    dryRun: false,
    stdout: false,
    overrides: {},
    help: false,
  };

  let index = 0;
  while (index < argv.length) {
    const arg = argv[index] ?? "";
    const [flag, inlineValue] = splitFlag(arg);

    const takeValue = (): string => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[index + 1];
      if (next === undefined)
        throw new Error(`Option ${flag} requires a value.`);
      index += 1;
      return next;
    };

    switch (flag) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--include-working-tree":
        options.includeWorkingTree = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--overwrite":
        options.overwrite = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--stdout":
        options.stdout = true;
        break;
      case "--base":
        options.base = takeValue();
        break;
      case "--repo":
        options.repoPath = takeValue();
        break;
      case "--run-id":
        options.runId = takeValue();
        break;
      case "--run-dir":
        options.runDir = takeValue();
        break;
      case "--out":
        options.outPath = takeValue();
        break;
      case "--provider":
        options.overrides.provider = takeValue();
        break;
      case "--model":
        options.overrides.model = takeValue();
        break;
      case "--voice":
        options.overrides.voice = takeValue();
        break;
      case "--format":
        options.overrides.format = takeValue();
        break;
      case "--instructions":
        options.overrides.instructions = takeValue();
        break;
      case "--max-scenes": {
        const value = Number(takeValue());
        if (!Number.isInteger(value) || value < 1) {
          throw new Error("--max-scenes must be a positive integer.");
        }
        options.maxScenes = value;
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}`);
    }

    index += 1;
  }
  return options;
}

function formatProgress(event: NarrationProgressEvent): string {
  const details: string[] = [];
  if (event.attempt !== undefined) details.push(`attempt ${event.attempt}`);
  if (event.delayMs !== undefined) details.push(`retry in ${event.delayMs} ms`);
  if (event.characters !== undefined) details.push(`${event.characters} chars`);
  if (event.durationMs !== undefined) details.push(`${event.durationMs} ms`);
  const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
  return `  ${event.sceneId}: ${event.status}${suffix}`;
}

/** Loads and validates an existing narrated plan; returns `null` when it is absent/invalid. */
async function tryResumeNarratedPlan(
  planPath: string,
  repositoryRoot: string,
): Promise<ExplainerPlan | null> {
  let raw: string;
  try {
    raw = await readFile(planPath, "utf8");
  } catch {
    return null;
  }

  let plan: ExplainerPlan;
  try {
    plan = JSON.parse(raw) as ExplainerPlan;
  } catch {
    return null;
  }

  const validation = await validateNarratedPlan({ plan, repositoryRoot });
  return validation.valid ? plan : null;
}

/**
 * Asserts the invariant that no stage switched branches or committed: HEAD and the current
 * branch must be unchanged from before the run. Read-only and best-effort — if the repository
 * can no longer be read, the original failure stands.
 */
async function verifyRepositoryUnchanged(context: RunContext): Promise<void> {
  try {
    const after = await getBranchState(context.repositoryRoot);
    if (
      after.headCommit !== context.head ||
      after.currentBranch !== context.branch
    ) {
      console.error(
        `error: the repository state changed during the run (HEAD ${context.head ?? "(none)"} -> ${after.headCommit ?? "(none)"}, branch ${context.branch ?? "(detached)"} -> ${after.currentBranch ?? "(detached)"}). No stage should switch branches or commit; inspect the repository manually.`,
      );
      process.exitCode = 1;
    }
  } catch {
    // The repository could not be re-read; keep the original failure as the outcome.
  }
}

function reportError(error: unknown): void {
  if (
    error instanceof MissingCredentialError ||
    error instanceof CredentialRejectedError
  ) {
    console.error(`error: ${error.message}`);
    process.exitCode = 4;
    return;
  }
  if (
    error instanceof NarrationConfigError ||
    error instanceof BaseResolutionError
  ) {
    console.error(`error: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  if (error instanceof PlanValidationError) {
    console.error("error: the generated plan failed validation:");
    for (const issue of error.issues) {
      console.error(`  - ${issue.path}: ${issue.message}`);
    }
    process.exitCode = 3;
    return;
  }
  console.error(
    `error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      `error: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(HELP);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(HELP);
    return;
  }

  const log = (message: string): void => console.error(message);

  // Offline test seams (inert unless EXPLAIN_BRANCH_TEST_* is set) — see testHooks.ts.
  const useFakeTts = fakeTtsEnabled();
  const skipRender = skipRenderEnabled();

  let context: RunContext | null = null;

  try {
    const repositoryRoot = await resolveRepositoryRoot(
      options.repoPath ?? process.cwd(),
    );

    // Project config supplies a default max-scenes; an explicit flag wins.
    const maxScenes =
      options.maxScenes ??
      (await readConfiguredMaxScenes(repositoryRoot)) ??
      undefined;

    log("[1/5] Inspecting the branch...");
    const inventory = await runInspect({
      ...(options.repoPath !== undefined ? { repoPath: options.repoPath } : {}),
      ...(options.base !== undefined ? { base: options.base } : {}),
      includeWorkingTree: options.includeWorkingTree,
    });

    const { runDir, relativeRunDir } = resolveRunDir({
      repositoryRoot,
      ...(options.runId !== undefined ? { runId: options.runId } : {}),
      ...(options.runDir !== undefined ? { runDir: options.runDir } : {}),
      branchName: inventory.currentBranch,
    });
    const relativeAudioDir = path.posix.join(relativeRunDir, "audio");
    const planPath = path.join(runDir, "plan.json");

    context = {
      repositoryRoot,
      runDir,
      head: inventory.headCommit,
      branch: inventory.currentBranch,
      planned: false,
    };

    // Disclosure before any long work (plan §11): state exactly what will be analysed.
    log(`Branch:       ${inventory.currentBranch ?? "(detached HEAD)"}`);
    log(
      `Base:         ${
        inventory.base !== null
          ? `${inventory.base.ref} (${inventory.base.source})`
          : "(unresolved)"
      }`,
    );
    log(
      `Working tree: ${
        inventory.workingTree.isDirty
          ? options.includeWorkingTree
            ? `dirty (${inventory.workingTree.changedPaths.length} change(s), included)`
            : `dirty (${inventory.workingTree.changedPaths.length} change(s), NOT included)`
          : "clean"
      }`,
    );
    log(`Run dir:      ${runDir}`);
    log(`Scenes:       up to ${maxScenes ?? 5} (including the summary)`);

    // --stdout is a plan-only mode: no narration, no render, and no files written.
    if (options.stdout) {
      log("[2/5] Building a scene plan (stdout)...");
      const { plan } = await runPlan({
        inventory,
        ...(maxScenes !== undefined ? { maxScenes } : {}),
      });
      process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      return;
    }

    // Resolve the narration config once (offline, validated) so the pre-flight disclosure can
    // report the exact voice/model and the precedence chain is applied in exactly one place.
    const { config } = await resolveNarrationConfig({
      repositoryRoot,
      overrides: options.overrides,
    });
    const plannedOut =
      options.outPath ??
      path.join(repositoryRoot, "artifacts", "branch-explainer.mp4");
    log(`Narration:    ${config.voice} (${config.model}, ${config.format})`);
    log(
      `Output:       ${
        options.dryRun
          ? "(dry run — no audio will be generated and nothing will be rendered)"
          : plannedOut
      }`,
    );

    let narratedPlan: ExplainerPlan | null = null;
    let narrateResult: NarrateStageResult | null = null;

    if (!options.force && !options.dryRun) {
      narratedPlan = await tryResumeNarratedPlan(planPath, repositoryRoot);
      if (narratedPlan !== null) {
        log(`[2/5] Reusing the validated narrated plan at ${planPath}`);
        log("[3/5] Narration already generated — skipping.");
      }
    }

    if (narratedPlan === null) {
      // Fail fast (exit 4) with a setup message before any planning or narration work: a
      // narrated video cannot be produced without credentials, and we never fall back to a
      // silent render. The offline test seam substitutes a provider instead.
      if (!options.dryRun && !useFakeTts) readOpenAiApiKey();

      log("[2/5] Building a scene plan...");
      const { plan } = await runPlan({
        inventory,
        ...(maxScenes !== undefined ? { maxScenes } : {}),
      });
      context.planned = true;

      // Checkpoint the pre-narration plan so a failed narration can resume without re-planning.
      // A dry run writes nothing at all.
      if (!options.dryRun) {
        await mkdir(runDir, { recursive: true });
        await writeFile(
          path.join(runDir, "branch-plan.json"),
          `${JSON.stringify(plan, null, 2)}\n`,
          "utf8",
        );
      }

      log("[3/5] Generating narration...");
      const narrate = await runNarrate({
        repositoryRoot,
        plan,
        runDir,
        relativeAudioDir,
        config,
        ...(useFakeTts
          ? { createProvider: () => createPlaceholderSpeechProvider() }
          : {}),
        ...(options.force ? { force: true } : {}),
        ...(options.dryRun ? { dryRun: true } : {}),
        planPath,
        onProgress: (event) => log(formatProgress(event)),
        log,
      });
      narrateResult = narrate;

      if (narrate.dryRun) {
        for (const clip of narrate.clips) {
          log(`  [dry run] ${clip.sceneId}: ${clip.characters} char(s)`);
        }
        log(
          `[dry run] ${narrate.clips.length} scene(s), ${narrate.totalCharacters} character(s); estimated cost $${narrate.costEstimate.usd.toFixed(4)}.`,
        );
        log("[dry run] No audio was generated and nothing was rendered.");
        // stdout carries only the machine-readable result; the human summary went to stderr.
        process.stdout.write(
          `${JSON.stringify(
            {
              dryRun: true,
              scenes: narrate.clips.length,
              totalCharacters: narrate.totalCharacters,
              estimatedCostUsd: narrate.costEstimate.usd,
              costBasis: narrate.costEstimate.basis,
            },
            null,
            2,
          )}\n`,
        );
        return;
      }

      const validation = await validateNarratedPlan({
        plan: narrate.plan,
        repositoryRoot,
      });
      if (!validation.valid) {
        console.error(
          `error: the narrated plan at ${planPath} failed validation:`,
        );
        for (const issue of validation.planErrors) {
          console.error(`  - ${issue.path}: ${issue.message}`);
        }
        for (const issue of validation.audioErrors) {
          console.error(`  - ${issue.path}: ${issue.message}`);
        }
        process.exitCode = 3;
        return;
      }

      narratedPlan = narrate.plan;
    }

    // Save the narration script alongside the plan and render input (§14.9).
    const narrationScriptPath = await writeNarrationScript(runDir, narratedPlan);

    log("[4/5] Rendering the video...");
    const render = await runRender({
      repositoryRoot,
      plan: narratedPlan,
      runDir,
      ...(options.outPath !== undefined ? { outPath: options.outPath } : {}),
      overwrite: options.overwrite,
      ...(skipRender ? { runner: createPlaceholderRenderRunner() } : {}),
      log,
    });

    if (render.exitCode !== 0) {
      process.exitCode = render.exitCode;
      log(`Render command failed: ${render.command}`);
      log(
        `Render failed (exit ${render.exitCode}). The plan and audio clips were kept under ${runDir}; re-run "npm run explain" to resume without regenerating cached audio.`,
      );
      if (context !== null) await verifyRepositoryUnchanged(context);
      return;
    }

    // A successful renderer exit is not enough: confirm the MP4 exists and is non-empty.
    const videoBytes = await verifyRenderedVideo(render.outPath);
    if (videoBytes === null) {
      console.error(
        `error: the renderer reported success but ${render.outPath} is missing or empty. Treating this as a render failure; the plan and audio clips were kept under ${runDir}.`,
      );
      if (context !== null) await verifyRepositoryUnchanged(context);
      process.exitCode = 1;
      return;
    }

    const report = buildRunReport({
      inventory,
      plan: narratedPlan,
      workingTreeIncluded: options.includeWorkingTree,
      config,
      ...(narrateResult !== null
        ? {
            cost: narrateResult.costEstimate,
            redaction: narrateResult.redaction,
          }
        : {}),
      video: { path: render.outPath, bytes: videoBytes },
      artifacts: {
        runDir,
        planJson: planPath,
        narrationScript: narrationScriptPath,
        renderInput: render.renderInputPath,
      },
    });
    const reportPath = await writeRunReport(runDir, report);

    log("[5/5] Done.");
    log(formatReportSummary(report));
    log(`Report:    ${reportPath}`);
    // stdout carries only the machine-readable report; human chatter stays on stderr.
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    reportError(error);
    if (context !== null) {
      await verifyRepositoryUnchanged(context);
      if (context.planned) {
        console.error(
          `The run directory ${context.runDir} was kept; re-run "npm run explain" to resume without regenerating cached audio (add --force to regenerate).`,
        );
      }
    }
  }
}

await main();
