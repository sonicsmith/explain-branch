#!/usr/bin/env node
/**
 * explain-branch — single command-line entry point.
 *
 * Thin dispatcher over the stage CLIs in `src/cli/`, each of which stays independently
 * runnable. A subcommand runs in its own `node` process so its exit code and stdio pass
 * through unmodified (important for `--stdout` piping and for the orchestrator's
 * machine-readable report).
 *
 * Usage:
 *   explain-branch <command> [options]
 *
 * Commands:
 *   inspect   Inventory the current branch's changes (read-only)
 *   plan      Build the scene scaffold (no narration)
 *   narrate   Generate narration audio for an authored plan
 *   render    Render a narrated plan to an MP4
 *   explain   Run the whole pipeline end to end (the main workflow)
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

interface Command {
  file: string;
  summary: string;
}

const COMMANDS: Record<string, Command> = {
  inspect: {
    file: "explainBranch.ts",
    summary: "Inventory the current branch's changes (read-only)",
  },
  plan: {
    file: "planBranch.ts",
    summary: "Build the scene scaffold (no narration)",
  },
  narrate: {
    file: "narrateBranch.ts",
    summary: "Generate narration audio for an authored plan",
  },
  render: {
    file: "renderBranch.ts",
    summary: "Render a narrated plan to an MP4",
  },
  explain: {
    file: "explainBranchVideo.ts",
    summary: "Run the whole pipeline end to end (the main workflow)",
  },
};

function commandPath(file: string): string {
  return fileURLToPath(new URL(`../src/cli/${file}`, import.meta.url));
}

async function readVersion(): Promise<string> {
  try {
    const raw = await readFile(
      new URL("../package.json", import.meta.url),
      "utf8",
    );
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function renderHelp(version: string): string {
  const lines = Object.entries(COMMANDS).map(
    ([name, command]) => `  ${name.padEnd(9)} ${command.summary}`,
  );
  return `explain-branch ${version} — turn the current Git branch into a narrated explainer video

Usage:
  explain-branch <command> [options]

Commands:
${lines.join("\n")}

Run "explain-branch <command> --help" for that command's own options.
`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [name, ...rest] = argv;

  if (name === undefined || name === "-h" || name === "--help") {
    process.stdout.write(renderHelp(await readVersion()));
    return;
  }

  if (name === "-v" || name === "--version") {
    process.stdout.write(`${await readVersion()}\n`);
    return;
  }

  const command = COMMANDS[name];
  if (command === undefined) {
    process.stderr.write(`error: unknown command "${name}"\n\n`);
    process.stderr.write(renderHelp(await readVersion()));
    process.exitCode = 1;
    return;
  }

  const child = spawn(process.execPath, [commandPath(command.file), ...rest], {
    stdio: "inherit",
  });

  const [code, signal] = await new Promise<
    [code: number | null, signal: NodeJS.Signals | null]
  >((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (closeCode, closeSignal) =>
      resolve([closeCode, closeSignal]),
    );
  });

  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 1;
}

await main();
