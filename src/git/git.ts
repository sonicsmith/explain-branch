import { execFile } from "node:child_process";

export interface GitResult {
  stdout: string;
  stderr: string;
}

/**
 * Raised when a `git` invocation fails. The original arguments are preserved so callers
 * can surface an actionable message without re-running the command.
 */
export class GitError extends Error {
  readonly args: readonly string[];
  readonly exitCode: number | null;

  constructor(
    message: string,
    args: readonly string[],
    exitCode: number | null,
  ) {
    super(message);
    this.name = "GitError";
    this.args = args;
    this.exitCode = exitCode;
  }
}

interface ExecTextOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  maxBuffer?: number;
}

function execFileText(
  command: string,
  args: readonly string[],
  options: ExecTextOptions,
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
        encoding: "utf8",
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({ stdout, stderr });
      },
    );
  });
}

/**
 * Environment that keeps Git strictly read-only and non-interactive:
 *
 * - `GIT_OPTIONAL_LOCKS=0` stops Git taking optional locks (for example refreshing the
 *   index), so inspection never writes to `.git`.
 * - `GIT_TERMINAL_PROMPT=0` prevents credential prompts from hanging the process.
 */
const READ_ONLY_GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_PAGER: "cat",
};

function describeFailure(error: unknown): {
  message: string;
  exitCode: number | null;
} {
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      stderr?: unknown;
      message?: unknown;
      code?: unknown;
    };
    const stderr =
      typeof candidate.stderr === "string" ? candidate.stderr.trim() : "";
    const firstLine = stderr.split("\n")[0] ?? stderr;
    const message =
      firstLine.length > 0
        ? firstLine
        : typeof candidate.message === "string"
          ? candidate.message
          : "unknown git failure";
    const exitCode = typeof candidate.code === "number" ? candidate.code : null;
    return { message, exitCode };
  }

  return { message: String(error), exitCode: null };
}

/**
 * Run `git` with an argument array. Arguments are never interpolated into a shell string,
 * so repository-controlled values (branch names, paths) cannot be executed.
 */
export async function git(
  args: readonly string[],
  cwd: string,
): Promise<GitResult> {
  const fullArgs = ["--no-pager", ...args];
  try {
    return await execFileText("git", fullArgs, { cwd, env: READ_ONLY_GIT_ENV });
  } catch (error) {
    const { message, exitCode } = describeFailure(error);
    throw new GitError(
      `git ${args.join(" ")} failed: ${message}`,
      args,
      exitCode,
    );
  }
}

/** Runs Git and resolves to `null` instead of throwing when the command fails. */
export async function gitOrNull(
  args: readonly string[],
  cwd: string,
): Promise<GitResult | null> {
  try {
    return await git(args, cwd);
  } catch {
    return null;
  }
}
