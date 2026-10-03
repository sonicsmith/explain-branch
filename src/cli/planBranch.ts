#!/usr/bin/env node
/**
 * Phase 2 scene-planning CLI.
 *
 * Builds a validated scene plan from the current branch's change inventory and writes it
 * to `artifacts/branch-plan.json` (or prints it with --stdout). Read-only with respect to
 * source: the only file it writes is the plan artifact under `artifacts/`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildChangeInventory,
  BaseResolutionError,
} from "../analysis/buildChangeInventory.ts";
import { validatePlan } from "../analysis/validatePlan.ts";
import { buildPlan } from "../planning/buildPlan.ts";
import type { ExplainerPlan } from "../planning/types.ts";
import { GitError } from "../git/git.ts";

interface CliOptions {
  base?: string;
  includeWorkingTree: boolean;
  repoPath?: string;
  outPath?: string;
  maxScenes: number;
  stdout: boolean;
  help: boolean;
}

const HELP = `explain-branch plan — build a validated scene plan (writes only under artifacts/)

Usage:
  explain-branch-plan [options]

Options:
  --base <ref>             Compare against this ref (highest precedence)
  --include-working-tree   Include uncommitted working-tree changes
  --repo <path>            Path inside the repository (default: cwd)
  --out <path>             Output path (default: <repo>/artifacts/branch-plan.json)
  --max-scenes <n>         Total scenes including the summary (default: 5)
  --stdout                 Print the plan JSON instead of writing a file
  -h, --help               Show this help

Exit codes: 0 success, 2 base could not be determined, 3 plan failed validation, 1 other error.
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
    const inventory = await buildChangeInventory({
      base: options.base,
      includeWorkingTree: options.includeWorkingTree,
      repoPath: options.repoPath,
    });

    const { plan, snapshot } = await buildPlan({
      repositoryRoot: inventory.repositoryRoot,
      inventory,
      maxScenes: options.maxScenes,
    });

    const validation = validatePlan(plan, { snapshot });
    if (!validation.valid) {
      console.error("error: the generated plan failed validation:");
      for (const issue of validation.errors) {
        console.error(`  - ${issue.path}: ${issue.message}`);
      }
      process.exitCode = 3;
      return;
    }

    const json = `${JSON.stringify(plan, null, 2)}\n`;

    if (options.stdout) {
      process.stdout.write(json);
      return;
    }

    const outputPath =
      options.outPath ??
      path.join(inventory.repositoryRoot, "artifacts", "branch-plan.json");
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, json, "utf8");

    console.log(formatSummary(plan, outputPath));
  } catch (error) {
    if (error instanceof BaseResolutionError) {
      console.error(`error: ${error.message}`);
      process.exitCode = 2;
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
