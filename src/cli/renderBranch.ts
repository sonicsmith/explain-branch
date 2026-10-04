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
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRepositoryRoot } from "../git/inspectBranch.ts";
import { capturePlanSnapshot } from "../narration/validateNarration.ts";
import type { ExplainerPlan } from "../planning/types.ts";
import { resolveOutputPath } from "../render/outputPath.ts";
import type { RenderInput } from "../render/RenderInput.ts";

const PLUGIN_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REMOTION_CLI = path.join(
  PLUGIN_ROOT,
  "node_modules",
  "@remotion",
  "cli",
  "remotion-cli.js",
);
const ENTRY_POINT = path.join(PLUGIN_ROOT, "src", "render", "index.ts");
const COMPOSITION_ID = "ExplainBranch";

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

/** Converts a captured snapshot into the plain `sources` map the renderer expects. */
async function captureSources(
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
      stdio: "inherit",
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
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

    const sources = await captureSources(plan, repositoryRoot);
    if (Object.keys(sources).length === 0 && plan.scenes.length > 0) {
      console.error(
        "warning: no source files were captured; code scenes will be empty.",
      );
    }

    const renderInput: RenderInput = { plan, sources, options: {} };
    const renderInputPath = path.join(
      path.dirname(planPath),
      "render-input.json",
    );
    await mkdir(path.dirname(renderInputPath), { recursive: true });
    await writeFile(
      renderInputPath,
      `${JSON.stringify(renderInput, null, 2)}\n`,
      "utf8",
    );

    const desiredOut =
      options.outPath ??
      path.join(repositoryRoot, "artifacts", "branch-explainer.mp4");
    const { path: outPath, collided } = await resolveOutputPath(desiredOut, {
      overwrite: options.overwrite,
    });
    if (collided && !options.overwrite) {
      console.error(
        `Existing output kept; writing a new file instead: ${outPath}`,
      );
    }

    const args = [
      "render",
      ENTRY_POINT,
      COMPOSITION_ID,
      outPath,
      `--props=${renderInputPath}`,
      `--public-dir=${repositoryRoot}`,
    ];
    if (!options.overwrite) args.push("--overwrite=false");

    console.error(
      `Rendering ${plan.scenes.length} scene(s) -> ${outPath} (props: ${renderInputPath})`,
    );

    const code = await runRemotion(args, PLUGIN_ROOT);
    if (code !== 0) {
      process.exitCode = code;
      return;
    }
    console.log(`Rendered: ${outPath}`);
  } catch (error) {
    console.error(
      `error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

await main();
