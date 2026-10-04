#!/usr/bin/env node
/**
 * Phase 4 render CLI: turn a narrated plan into the final MP4.
 *
 * The Remotion composition needs a full `RenderInput` — `{ plan, sources, options }` — not a
 * bare plan. This CLI reads the plan, captures the source files it references (committed
 * content, falling back to the working tree), writes a `render-input.json` props file next to
 * the plan, and renders with the repository root as the public dir so `staticFile()` resolves
 * the audio clips.
 *
 * Writes only `render-input.json` and the output MP4; never overwrites silently.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveRepositoryRoot } from "../git/inspectBranch.ts";
import type { ExplainerPlan } from "../planning/types.ts";
import { runRender } from "../pipeline/stages.ts";

interface CliOptions {
  repoPath?: string;
  planPath?: string;
  outPath?: string;
  overwrite: boolean;
  help: boolean;
}

const HELP = `explain-branch render — render the narrated plan to an MP4 (writes only under artifacts/)

Usage:
  explain-branch-render [options]

Options:
  --plan <path>    Narrated plan JSON (default: <repo>/artifacts/branch-plan.json)
  --repo <path>    Path inside the repository (default: cwd)
  --out <path>     Output MP4 (default: <repo>/artifacts/branch-explainer.mp4)
  --overwrite      Allow replacing an existing output (default: write a timestamped name)
  -h, --help       Show this help

A <plan-dir>/render-input.json props file (plan + captured sources) is written for you and
passed to Remotion. The repository root is used as --public-dir so audio clips resolve.`;

function splitFlag(
  arg: string,
): [flag: string, inlineValue: string | undefined] {
  const equals = arg.indexOf("=");
  if (equals === -1) return [arg, undefined];
  return [arg.slice(0, equals), arg.slice(equals + 1)];
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { overwrite: false, help: false };
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
      case "--overwrite":
        options.overwrite = true;
        break;
      case "--plan":
        options.planPath = takeValue();
        break;
      case "--repo":
        options.repoPath = takeValue();
        break;
      case "--out":
        options.outPath = takeValue();
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
    index += 1;
  }
  return options;
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
        `error: could not read the plan at ${planPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      process.exitCode = 3;
      return;
    }

    const result = await runRender({
      repositoryRoot,
      plan,
      runDir: path.dirname(planPath),
      ...(options.outPath !== undefined ? { outPath: options.outPath } : {}),
      overwrite: options.overwrite,
      log: (message) => console.error(message),
    });

    if (result.exitCode !== 0) {
      process.exitCode = result.exitCode;
      return;
    }
    console.log(`Rendered: ${result.outPath}`);
  } catch (error) {
    console.error(
      `error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

await main();
