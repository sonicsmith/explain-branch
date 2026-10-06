import path from "node:path";
import { readFile } from "node:fs/promises";
import { git, gitOrNull } from "./git.ts";

/** How the comparison base was chosen (see plan §6 for the precedence order). */
export type BaseSource =
  | "explicit"
  | "config"
  | "remote"
  | "upstream"
  | "conventional";

export interface BranchState {
  repositoryRoot: string;
  repositoryName: string;
  /** `null` when HEAD is detached. */
  currentBranch: string | null;
  detachedHead: boolean;
  /** `null` in a repository with no commits yet. */
  headCommit: string | null;
  isShallow: boolean;
}

export interface WorkingTreeState {
  isDirty: boolean;
  changedPaths: string[];
  untrackedPaths: string[];
}

/** Raised when no comparison base can be chosen safely; the user must supply one. */
export class BaseResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaseResolutionError";
  }
}

/** Resolves the repository root for a starting path, or throws a friendly error. */
export async function resolveRepositoryRoot(
  startPath: string,
): Promise<string> {
  const result = await gitOrNull(["rev-parse", "--show-toplevel"], startPath);
  const root = result?.stdout.trim();
  if (root === undefined || root === "") {
    throw new Error(`${startPath} is not inside a Git repository.`);
  }
  return root;
}

export async function getBranchState(startPath: string): Promise<BranchState> {
  const repositoryRoot = await resolveRepositoryRoot(startPath);

  const symbolic =
    (
      await gitOrNull(
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        repositoryRoot,
      )
    )?.stdout.trim() ?? "";
  const headCommit =
    (
      await gitOrNull(
        ["rev-parse", "--verify", "--quiet", "HEAD"],
        repositoryRoot,
      )
    )?.stdout.trim() ?? "";
  const isShallow =
    (
      await gitOrNull(["rev-parse", "--is-shallow-repository"], repositoryRoot)
    )?.stdout.trim() === "true";

  return {
    repositoryRoot,
    repositoryName: path.basename(repositoryRoot),
    currentBranch: symbolic === "" ? null : symbolic,
    detachedHead: symbolic === "",
    headCommit: headCommit === "" ? null : headCommit,
    isShallow,
  };
}

/**
 * Reads a configured base from project configuration: `.explain-branch.json`
 * (`{"base": "..."}`) or the `explainBranch.base` field of `package.json`.
 */
export async function readConfiguredBase(
  repositoryRoot: string,
): Promise<string | null> {
  try {
    const raw = await readFile(
      path.join(repositoryRoot, ".explain-branch.json"),
      "utf8",
    );
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const base = (parsed as { base?: unknown }).base;
      if (typeof base === "string" && base.trim() !== "") return base.trim();
    }
  } catch {
    // Missing or invalid config is not an error; fall through to the next source.
  }

  try {
    const raw = await readFile(
      path.join(repositoryRoot, "package.json"),
      "utf8",
    );
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const base = (parsed as { explainBranch?: { base?: unknown } })
        .explainBranch?.base;
      if (typeof base === "string" && base.trim() !== "") return base.trim();
    }
  } catch {
    // ignore
  }

  return null;
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
  const result = await gitOrNull(
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    cwd,
  );
  return result !== null;
}

export interface ResolveBaseArgs {
  cwd: string;
  currentBranch: string | null;
  explicit?: string | undefined;
  configured?: string | null | undefined;
}

/** Strips the remote prefix from an upstream ref (e.g. `origin/main` -> `main`). */
function upstreamBranchName(ref: string): string {
  const slash = ref.indexOf("/");
  return slash === -1 ? ref : ref.slice(slash + 1);
}

/**
 * Resolves the comparison base using the documented precedence:
 * explicit > configured > remote default branch > upstream > conventional base.
 * An upstream is ignored when it is merely the current branch's own remote copy
 * (which would compare HEAD against itself and yield an empty diff).
 * Throws {@link BaseResolutionError} when the choice is unsafe and the user must decide.
 */
export async function resolveBase(
  args: ResolveBaseArgs,
): Promise<{ ref: string; source: BaseSource }> {
  const { cwd, currentBranch, explicit, configured } = args;

  if (explicit !== undefined && explicit.trim() !== "") {
    if (!(await refExists(cwd, explicit))) {
      throw new BaseResolutionError(
        `The base ref "${explicit}" does not resolve to a commit in this repository. Check the name and try again.`,
      );
    }
    return { ref: explicit, source: "explicit" };
  }

  if (
    configured !== undefined &&
    configured !== null &&
    configured.trim() !== "" &&
    (await refExists(cwd, configured))
  ) {
    return { ref: configured, source: "config" };
  }

  // Prefer the remote's default branch (origin/HEAD -> e.g. origin/main); it is the base a pull
  // request typically targets. Unlike a same-named upstream, it stays useful when reached from
  // the default branch itself (it then reflects unpushed commits).
  const remoteHead =
    (
      await gitOrNull(["rev-parse", "--abbrev-ref", "origin/HEAD"], cwd)
    )?.stdout.trim() ?? "";
  if (
    remoteHead !== "" &&
    remoteHead !== "origin/HEAD" &&
    (await refExists(cwd, remoteHead))
  ) {
    return { ref: remoteHead, source: "remote" };
  }

  // An upstream is only a useful base when it is not the current branch's own remote copy.
  const upstream =
    (
      await gitOrNull(
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
        cwd,
      )
    )?.stdout.trim() ?? "";
  if (
    upstream !== "" &&
    (await refExists(cwd, upstream)) &&
    upstreamBranchName(upstream) !== currentBranch
  ) {
    return { ref: upstream, source: "upstream" };
  }

  const existing: string[] = [];
  for (const candidate of ["main", "master"]) {
    if (candidate === currentBranch) continue;

    const local = await gitOrNull(
      ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`],
      cwd,
    );
    const remote = await gitOrNull(
      ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${candidate}`],
      cwd,
    );
    if (local !== null || remote !== null) existing.push(candidate);
  }

  const onlyCandidate = existing.length === 1 ? existing[0] : undefined;
  if (onlyCandidate !== undefined) {
    return { ref: onlyCandidate, source: "conventional" };
  }

  const detail =
    existing.length === 0
      ? 'neither "main" nor "master" exists and no upstream is configured'
      : 'both "main" and "master" exist, so the conventional base is ambiguous';

  throw new BaseResolutionError(
    `Could not determine a comparison base: ${detail}. ` +
      'Specify one with --base <ref>, or add {"base": "<ref>"} to .explain-branch.json in the repository root.',
  );
}

/** Reads working-tree status without modifying the repository. */
export async function readWorkingTreeState(
  cwd: string,
): Promise<WorkingTreeState> {
  const output =
    (
      await gitOrNull(
        ["status", "--porcelain=v1", "--untracked-files=normal"],
        cwd,
      )
    )?.stdout ?? "";

  const changedPaths: string[] = [];
  const untrackedPaths: string[] = [];

  for (const line of output.split("\n")) {
    if (line.trim().length < 4) continue;

    const status = line.slice(0, 2);
    let filePath = line.slice(3);
    const arrow = filePath.indexOf(" -> ");
    if (arrow !== -1) filePath = filePath.slice(arrow + 4);

    changedPaths.push(filePath);
    if (status === "??") untrackedPaths.push(filePath);
  }

  return { isDirty: changedPaths.length > 0, changedPaths, untrackedPaths };
}

/** Commit counts relative to a ref; `ahead` = commits HEAD has that the ref lacks. */
export async function readAheadBehind(
  cwd: string,
  ref: string,
): Promise<{ ahead: number; behind: number }> {
  const output = (
    await gitOrNull(
      ["rev-list", "--left-right", "--count", `${ref}...HEAD`],
      cwd,
    )
  )?.stdout.trim();

  if (output === undefined || output === "") return { ahead: 0, behind: 0 };

  const [left, right] = output.split(/\s+/);
  const behind = Number(left ?? "0");
  const ahead = Number(right ?? "0");

  return {
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
  };
}

/** Exposed so callers can distinguish "not a repo" from other Git failures. */
export { git };
