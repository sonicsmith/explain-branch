#!/usr/bin/env node
/**
 * Phase 4 narration CLI: enrich a branch plan with per-scene narration audio and durations.
 *
 * Reads a validated plan JSON, generates one TTS clip per scene under
 * `artifacts/<run-id>/audio/`, measures each clip's duration, and writes the enriched plan
 * to `artifacts/<run-id>/plan.json`. Read-only with respect to source; all writes stay under
 * the run directory (or `--out`).
 *
 * Credentials: requires `OPENAI_API_KEY` unless `--dry-run` is set.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveRepositoryRoot } from "../git/inspectBranch.ts";
import {
  NarrationConfigError,
  type NarrationConfigOverrides,
} from "../narration/config.ts";
import {
  CredentialRejectedError,
  MissingCredentialError,
} from "../narration/credentials.ts";
import {
  audioFileName,
  type NarrationProgressEvent,
} from "../narration/narratePlan.ts";
import { validateNarratedPlan } from "../narration/validateNarration.ts";
import type { ExplainerPlan } from "../planning/types.ts";
import { resolveRunDir, runNarrate } from "../pipeline/stages.ts";

interface CliOptions {
  repoPath?: string;
  planPath?: string;
  runId?: string;
  runDir?: string;
  outPath?: string;
  dryRun: boolean;
  force: boolean;
  sceneIds: string[];
  overrides: NarrationConfigOverrides;
  help: boolean;
}

const HELP = `explain-branch narrate — generate per-scene narration audio (writes only under artifacts/)

Usage:
  explain-branch-narrate [options]

Options:
  --plan <path>        Plan JSON to narrate (default: <repo>/artifacts/branch-plan.json)
  --repo <path>        Path inside the repository (default: cwd)
  --run-id <id>        Run directory name (default: the branch name, so re-runs reuse clips)
  --run-dir <path>     Explicit run directory (default: <repo>/artifacts/<run-id>)
  --out <path>         Where to write the enriched plan (default: <run-dir>/plan.json)
  --dry-run            Report scenes, character counts, and estimated cost; no API calls
  --force              Regenerate clips even when a matching cached clip exists
  --scene <id>         Only (re)generate this scene; repeatable
  --provider <name>    Narration provider (default: openai)
  --model <id>         TTS model (default: gpt-4o-mini-tts)
  --voice <name>       Voice (default: marin)
  --format <fmt>       Audio format: mp3|opus|aac|flac|wav|pcm (default: wav)
  --instructions <txt> Tone/style instructions (gpt-4o-mini-tts only)
  -h, --help           Show this help

Exit codes: 0 success, 2 invalid configuration, 3 plan could not be read, 4 missing/rejected credentials, 1 other error.

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
    dryRun: false,
    force: false,
    sceneIds: [],
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
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--scene":
        options.sceneIds.push(takeValue());
        break;
      case "--plan":
        options.planPath = takeValue();
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

  try {
    const repositoryRoot = await resolveRepositoryRoot(
      options.repoPath ?? process.cwd(),
    );

    const planPath =
      options.planPath ??
      path.join(repositoryRoot, "artifacts", "branch-plan.json");

    let plan: ExplainerPlan;
    try {
      plan = JSON.parse(await readFile(planPath, "utf8")) as ExplainerPlan;
    } catch (error) {
      console.error(
        `error: could not read the plan at ${planPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 3;
      return;
    }

    // Pre-flight redaction, run-directory resolution, config resolution, credential
    // handling, generation, duration measurement, and plan writing all live in the shared
    // narrate stage so the orchestrator runs exactly this code.
    const { runDir, relativeRunDir } = resolveRunDir({
      repositoryRoot,
      ...(options.runId !== undefined ? { runId: options.runId } : {}),
      ...(options.runDir !== undefined ? { runDir: options.runDir } : {}),
      branchName: plan.branchName,
    });
    const relativeAudioDir = path.posix.join(relativeRunDir, "audio");

    const result = await runNarrate({
      repositoryRoot,
      plan,
      runDir,
      relativeAudioDir,
      overrides: options.overrides,
      ...(options.outPath !== undefined ? { planPath: options.outPath } : {}),
      ...(options.force !== undefined ? { force: options.force } : {}),
      ...(options.sceneIds.length > 0 ? { sceneIds: options.sceneIds } : {}),
      ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
      onProgress: (event) => console.error(formatProgress(event)),
      log: (message) => console.error(message),
    });

    const cost = result.costEstimate;
    console.log(
      `${result.dryRun ? "Dry run" : "Narrated"}: ${result.clips.length} scene(s), ${result.totalCharacters} character(s).`,
    );
    console.log(
      `Estimated cost: $${cost.usd.toFixed(4)} (${cost.basis}${cost.complete ? "" : "; incomplete"})`,
    );

    if (result.dryRun) {
      for (const clip of result.clips) {
        console.log(`  ${clip.sceneId}: ${clip.characters} char(s)`);
      }
      console.log("No audio was generated.");
      return;
    }

    const generated = result.clips.filter((clip) => !clip.cached).length;
    const cached = result.clips.filter((clip) => clip.cached).length;
    console.log(`Clips:    ${generated} generated, ${cached} reused`);
    console.log(`Plan:     ${result.planPath}`);
    for (const clip of result.clips) {
      if (clip.audioPath === undefined) continue;
      console.log(
        `  ${audioFileName(clip.sceneId, result.config.format)} -> ${clip.audioPath}`,
      );
    }

    // Second layer of validation: schema + source refs (requireNarrationAudio) and the clips
    // themselves (exist, decodable, duration matches). Fail loudly rather than claim success.
    const validation = await validateNarratedPlan({
      plan: result.plan,
      repositoryRoot,
    });
    if (!validation.valid) {
      console.error("error: the narrated plan failed validation:");
      for (const issue of validation.planErrors) {
        console.error(`  - ${issue.path}: ${issue.message}`);
      }
      for (const issue of validation.audioErrors) {
        console.error(`  - ${issue.path}: ${issue.message}`);
      }
      process.exitCode = 3;
      return;
    }
    console.log(
      `Validated: ${result.plan.scenes.length} scene(s) with narration audio.`,
    );
  } catch (error) {
    if (error instanceof MissingCredentialError) {
      console.error(`error: ${error.message}`);
      process.exitCode = 4;
      return;
    }
    if (error instanceof CredentialRejectedError) {
      console.error(`error: ${error.message}`);
      process.exitCode = 4;
      return;
    }
    if (error instanceof NarrationConfigError) {
      console.error(`error: ${error.message}`);
      process.exitCode = 2;
      return;
    }
    console.error(
      `error: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (!options.dryRun) {
      console.error(
        "Already-generated clips were kept under the run directory; re-running resumes from them without regenerating cached audio.",
      );
    }
    process.exitCode = 1;
  }
}

await main();
