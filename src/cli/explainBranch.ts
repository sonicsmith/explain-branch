#!/usr/bin/env node
/**
 * Phase 1 branch-inspection CLI.
 *
 * Prints a structured inventory of the current branch's changes relative to a resolved
 * base. Read-only: it never checks out, resets, stashes, commits, or writes to the
 * repository. Exits 0 on success, 2 when a base must be chosen by the user, 1 on other
 * errors.
 */
import {
  BaseResolutionError,
  type ChangeInventory,
  type InventoryFile,
} from "../analysis/buildChangeInventory.ts";
import { GitError } from "../git/git.ts";
import type { ChangeType } from "../git/parseDiff.ts";
import { runInspect } from "../pipeline/stages.ts";

interface CliOptions {
  base?: string;
  includeWorkingTree: boolean;
  repoPath?: string;
  json: boolean;
  help: boolean;
}

const CHANGE_LABELS: Record<ChangeType, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  "type-changed": "T",
  unknown: "?",
};

const HELP = `explain-branch — inventory the current branch's changes (read-only)

Usage:
  explain-branch [options]

Options:
  --base <ref>             Compare against this ref (highest precedence)
  --include-working-tree   Include uncommitted working-tree changes
  --repo <path>            Path inside the repository (default: cwd)
  --json                   Print the full inventory as JSON
  -h, --help               Show this help

Base precedence: --base > .explain-branch.json / package.json > upstream > main|master.
Exit codes: 0 success, 2 base could not be determined, 1 other error.
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
    json: false,
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
      case "--json":
        options.json = true;
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
      default:
        throw new Error(`Unknown option: ${arg}`);
    }

    index += 1;
  }

  return options;
}

function shortSha(sha: string | null): string {
  return sha === null ? "(none)" : sha.slice(0, 12);
}

function formatFile(file: InventoryFile): string {
  const badge = CHANGE_LABELS[file.changeType] ?? "?";
  const origin = file.source === "working-tree" ? " (wt)" : "";
  const rename = file.oldPath === null ? "" : ` <- ${file.oldPath}`;
  const binary = file.isBinary ? " [binary]" : "";
  const generated = file.isGenerated
    ? ` [generated: ${file.generatedReason ?? "yes"}]`
    : "";
  const counts =
    file.isBinary || file.source === "working-tree"
      ? ""
      : ` +${file.addedLineCount} -${file.deletedLineCount} (${file.hunks.length} hunk${file.hunks.length === 1 ? "" : "s"})`;

  return `  ${badge} ${file.path}${rename}${origin} [${file.language}]${counts}${binary}${generated}`;
}

function formatHuman(inventory: ChangeInventory): string {
  const lines: string[] = [];
  lines.push(
    `Repository:   ${inventory.repositoryName} (${inventory.repositoryRoot})`,
  );
  lines.push(`Branch:       ${inventory.currentBranch ?? "(detached HEAD)"}`);
  lines.push(`HEAD:         ${shortSha(inventory.headCommit)}`);

  if (inventory.base !== null) {
    lines.push(
      `Base:         ${inventory.base.ref} (${inventory.base.source})`,
    );
    lines.push(`Merge base:   ${shortSha(inventory.base.mergeBase)}`);
    lines.push(
      `Ahead/Behind: +${inventory.base.ahead} / -${inventory.base.behind}`,
    );
  } else {
    lines.push("Base:         (unresolved)");
  }

  const treeState = inventory.workingTree.isDirty
    ? inventory.workingTree.included
      ? `dirty (${inventory.workingTree.changedPaths.length} change(s), included)`
      : `dirty (${inventory.workingTree.changedPaths.length} change(s), NOT included)`
    : "clean";
  lines.push(`Working tree: ${treeState}`);
  lines.push(`Changes:      ${inventory.files.length} file(s)`);

  if (inventory.files.length > 0) {
    lines.push("");
    for (const file of inventory.files) {
      lines.push(formatFile(file));
    }
  }

  if (inventory.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of inventory.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

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
    const inventory = await runInspect({
      base: options.base,
      includeWorkingTree: options.includeWorkingTree,
      repoPath: options.repoPath,
    });

    console.log(
      options.json
        ? JSON.stringify(inventory, null, 2)
        : formatHuman(inventory),
    );
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
