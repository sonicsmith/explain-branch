#!/usr/bin/env node
/**
 * Scene-scaffold CLI.
 *
 * Builds the deterministic **scaffold** for a branch (grouping, source locations, suggested
 * walkthrough steps) and writes it to `artifacts/plan.scaffold.json` (or prints it with
 * `--stdout`). The scaffold has no narration: the host coding agent reads the code and
 * authors the plan (see `skills/explain-branch/SKILL.md`), then renders it via
 * `npm run explain -- --plan <path>`. Read-only with respect to source.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BaseResolutionError } from "../analysis/buildChangeInventory.ts";
import type { ExplainerPlan } from "../planning/types.ts";
import { GitError } from "../git/git.ts";
import { PlanValidationError, runScaffold } from "../pipeline/stages.ts";

interface CliOptions {
  base?: string;
  includeWorkingTree: boolean;
  repoPath?: string;
  outPath?: string;
  maxScenes: number;
  stdout: boolean;
  help: boolean;
}

const HELP = `explain-branch plan — build the scene scaffold for a branch (writes only under artifacts/)

Usage:
  explain-branch-plan [options]

Options:
  --base <ref>             Compare against this ref (highest precedence)
  --include-working-tree   Include uncommitted working-tree changes
  --repo <path>            Path inside the repository (default: cwd)
  --out <path>             Output path (default: <repo>/artifacts/plan.scaffold.json)
  --max-scenes <n>         Total scenes including the summary (default: 5)
  --stdout                 Print the scaffold JSON instead of writing a file
  -h, --help               Show this help

The scaffold has no narration. The host coding agent authors the explanations and steps, then
renders with:  npm run explain -- --plan <plan.json>

Exit codes: 0 success, 2 base could not be determined, 3 scaffold failed validation, 1 other.
`;

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
    maxScenes: 5,
    stdout: false,
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
      case "--stdout":
        options.stdout = true;
        break;
      case "--include-working-tree":
        options.includeWorkingTree = true;
        break;
      case "--base":
        options.base = takeValue();
        break;
      case "--repo":
        options.repoPath = takeValue();
        break;
      case "--out":
        options.outPath = takeValue();
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

function formatSummary(plan: ExplainerPlan, outputPath: string): string {
  const lines: string[] = [];
  lines.push(`Branch:   ${plan.branchName}`);
  lines.push(`Base:     ${plan.baseRef}`);
  lines.push(`Scenes:   ${plan.scenes.length}`);
  for (const scene of plan.scenes) {
    const locations = scene.sourceLocations.length;
    lines.push(
      `  - [${scene.visual}] ${scene.title} (${locations} location(s))`,
    );
  }
  if (plan.omissions.length > 0) {
    lines.push(`Omitted:  ${plan.omissions.length} file(s)`);
  }
  if (plan.caveats.length > 0) {
    lines.push(`Caveats:  ${plan.caveats.length}`);
  }
  lines.push(`Written:  ${outputPath}`);
  return lines.join("\n");
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
    const { inventory, plan } = await runScaffold({
      base: options.base,
      includeWorkingTree: options.includeWorkingTree,
      repoPath: options.repoPath,
      maxScenes: options.maxScenes,
    });

    const json = `${JSON.stringify(plan, null, 2)}\n`;

    if (options.stdout) {
      process.stdout.write(json);
      return;
    }

    const outputPath =
      options.outPath ??
      path.join(inventory.repositoryRoot, "artifacts", "plan.scaffold.json");
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, json, "utf8");

    console.log(formatSummary(plan, outputPath));
  } catch (error) {
    if (error instanceof BaseResolutionError) {
      console.error(`error: ${error.message}`);
      process.exitCode = 2;
      return;
    }
    if (error instanceof PlanValidationError) {
      console.error("error: the generated scaffold failed validation:");
      for (const issue of error.issues) {
        console.error(`  - ${issue.path}: ${issue.message}`);
      }
      process.exitCode = 3;
      return;
    }
    if (error instanceof GitError) {
      console.error(`error: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    console.error(
      `error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

await main();
