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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveRepositoryRoot } from "../git/inspectBranch.ts";
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
import {
  audioFileName,
  narratePlan,
  type NarrationProgressEvent,
} from "../narration/narratePlan.ts";
import { createOpenAiSpeechProvider } from "../narration/openaiSpeechProvider.ts";
import { NarrationError, type SpeechProvider } from "../narration/provider.ts";
import type { ExplainerPlan } from "../planning/types.ts";

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

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function defaultRunId(plan: ExplainerPlan): string {
  const safe = (plan.branchName ?? "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return safe === "" ? "run" : safe;
}

function formatProgress(event: NarrationProgressEvent): string {
  const details: string[] = [];
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

    const { config } = await resolveNarrationConfig({
      repositoryRoot,
      overrides: options.overrides,
    });

    const runId = options.runId ?? defaultRunId(plan);
    const runDir =
      options.runDir !== undefined
        ? path.resolve(repositoryRoot, options.runDir)
        : path.join(repositoryRoot, "artifacts", runId);

    const relativeRunDir = toPosix(path.relative(repositoryRoot, runDir));
    if (
      relativeRunDir === "" ||
      relativeRunDir === "." ||
      relativeRunDir.startsWith("../")
    ) {
      throw new NarrationError(
        "The run directory must be inside the repository so plan audio paths stay repository-relative.",
      );
    }

    const audioDir = path.join(runDir, "audio");
    const relativeAudioDir = path.posix.join(relativeRunDir, "audio");

    let provider: SpeechProvider | undefined;
    if (!options.dryRun) {
      const apiKey = readOpenAiApiKey();
      provider = createOpenAiSpeechProvider({ apiKey });
    }

    console.error(
      `Narrating ${plan.scenes.length} scene(s) with ${config.model} (${config.voice}, ${config.format})${options.dryRun ? " [dry run]" : ""}.`,
    );

    const result = await narratePlan({
      plan,
      config,
      audioDir,
      relativeAudioDir,
      ...(provider !== undefined ? { provider } : {}),
      force: options.force,
      ...(options.sceneIds.length > 0 ? { sceneIds: options.sceneIds } : {}),
      dryRun: options.dryRun,
      onProgress: (event) => console.error(formatProgress(event)),
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

    const outPath = options.outPath ?? path.join(runDir, "plan.json");
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(
      outPath,
      `${JSON.stringify(result.plan, null, 2)}\n`,
      "utf8",
    );
    console.log(`Plan:     ${outPath}`);
    for (const clip of result.clips) {
      if (clip.audioPath === undefined) continue;
      console.log(
        `  ${audioFileName(clip.sceneId, config.format)} -> ${clip.audioPath}`,
      );
    }
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
    process.exitCode = 1;
  }
}

await main();
