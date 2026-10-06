import { git, gitOrNull } from "../git/git.ts";
import {
  getBranchState,
  readAheadBehind,
  readConfiguredBase,
  readWorkingTreeState,
  resolveBase,
  type BaseSource,
} from "../git/inspectBranch.ts";
import {
  parseUnifiedDiff,
  type ChangeType,
  type DiffHunk,
  type ParsedFileDiff,
} from "../git/parseDiff.ts";
import { classifyGenerated, detectLanguage } from "./fileClassification.ts";

export { BaseResolutionError } from "../git/inspectBranch.ts";
export type { BaseSource } from "../git/inspectBranch.ts";

export interface InventoryFile {
  path: string;
  oldPath: string | null;
  changeType: ChangeType;
  /**
   * `"working-tree"` when the captured content comes from the working tree (the path
   * differs from HEAD); `"branch"` when it matches HEAD. When working-tree changes are
   * included, the working tree takes precedence for a path changed in both places.
   */
  source: "branch" | "working-tree";
  language: string;
  isGenerated: boolean;
  generatedReason: string | null;
  isBinary: boolean;
  addedLineCount: number;
  deletedLineCount: number;
  hunks: DiffHunk[];
}

export interface ChangeInventory {
  repositoryRoot: string;
  repositoryName: string;
  currentBranch: string | null;
  detachedHead: boolean;
  headCommit: string | null;
  isShallow: boolean;
  base: {
    ref: string;
    source: BaseSource;
    mergeBase: string | null;
    ahead: number;
    behind: number;
  } | null;
  workingTree: {
    isDirty: boolean;
    included: boolean;
    changedPaths: string[];
  };
  files: InventoryFile[];
  warnings: string[];
}

export interface BuildChangeInventoryOptions {
  /** Path inside the repository; defaults to the current working directory. */
  repoPath?: string;
  /** Explicit comparison base (highest precedence). */
  base?: string;
  /** Include uncommitted working-tree changes in the inventory. Defaults to `false`. */
  includeWorkingTree?: boolean;
  /** Pre-resolved configured base; when omitted, project configuration is read. */
  configuredBase?: string | null;
}

/**
 * Flags that keep `git diff` read-only and free of repository-controlled behaviour:
 * `--no-ext-diff` and `--no-textconv` prevent configured external diff drivers and
 * textconv filters (arbitrary programs) from running.
 */
const DIFF_FLAGS = [
  "diff",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--find-renames",
  "--find-copies",
  "--unified=3",
] as const;

function toInventoryFile(
  parsed: ParsedFileDiff,
  source: "branch" | "working-tree",
): InventoryFile {
  const generated = classifyGenerated(parsed.path);
  return {
    path: parsed.path,
    oldPath: parsed.oldPath,
    changeType: parsed.changeType,
    source,
    language: detectLanguage(parsed.path),
    isGenerated: generated.isGenerated,
    generatedReason: generated.reason,
    isBinary: parsed.isBinary,
    addedLineCount: parsed.addedLineCount,
    deletedLineCount: parsed.deletedLineCount,
    hunks: parsed.hunks,
  };
}

/**
 * Builds a structured inventory of the changes introduced by the current branch relative
 * to a resolved base. Never modifies the repository: all Git calls are read-only and the
 * only writes in the wider pipeline happen under `artifacts/`.
 */
export async function buildChangeInventory(
  options: BuildChangeInventoryOptions = {},
): Promise<ChangeInventory> {
  const startPath = options.repoPath ?? process.cwd();
  const state = await getBranchState(startPath);
  const warnings: string[] = [];

  if (state.isShallow) {
    warnings.push(
      "This is a shallow clone; the merge base and commit history may be incomplete.",
    );
  }

  const workingTree = await readWorkingTreeState(state.repositoryRoot);

  if (state.headCommit === null) {
    warnings.push(
      "The repository has no commits yet, so there are no branch changes to inventory.",
    );
    return {
      repositoryRoot: state.repositoryRoot,
      repositoryName: state.repositoryName,
      currentBranch: state.currentBranch,
      detachedHead: state.detachedHead,
      headCommit: null,
      isShallow: state.isShallow,
      base: null,
      workingTree: {
        isDirty: workingTree.isDirty,
        included: false,
        changedPaths: workingTree.changedPaths,
      },
      files: [],
      warnings,
    };
  }

  const configuredBase =
    options.configuredBase !== undefined
      ? options.configuredBase
      : await readConfiguredBase(state.repositoryRoot);

  const resolvedBase = await resolveBase({
    cwd: state.repositoryRoot,
    currentBranch: state.currentBranch,
    explicit: options.base,
    configured: configuredBase,
  });

  const mergeBaseOutput =
    (
      await gitOrNull(
        ["merge-base", resolvedBase.ref, "HEAD"],
        state.repositoryRoot,
      )
    )?.stdout.trim() ?? "";
  const mergeBase = mergeBaseOutput === "" ? null : mergeBaseOutput;
  const compareRef = mergeBase ?? resolvedBase.ref;

  if (mergeBase === null) {
    warnings.push(
      `No common ancestor was found between "${resolvedBase.ref}" and HEAD; comparing directly against "${resolvedBase.ref}".`,
    );
  }

  const { ahead, behind } = await readAheadBehind(
    state.repositoryRoot,
    resolvedBase.ref,
  );

  const includeWorkingTree = options.includeWorkingTree === true;
  const dirtyPaths = new Set(workingTree.changedPaths);
  let files: InventoryFile[];

  if (includeWorkingTree) {
    // Diff the working tree against the merge base so committed and uncommitted changes for
    // the same path are consolidated into one entry whose hunks share a frame of reference
    // with the snapshot content (the working tree on disk). Paths that differ from HEAD are
    // attributed to the working tree, which then takes precedence.
    const workingDiff = (
      await git([...DIFF_FLAGS, compareRef], state.repositoryRoot)
    ).stdout;
    files = parseUnifiedDiff(workingDiff).map((parsed) =>
      toInventoryFile(
        parsed,
        dirtyPaths.has(parsed.path) ? "working-tree" : "branch",
      ),
    );

    for (const untrackedPath of workingTree.untrackedPaths) {
      const generated = classifyGenerated(untrackedPath);
      files.push({
        path: untrackedPath,
        oldPath: null,
        changeType: "added",
        source: "working-tree",
        language: detectLanguage(untrackedPath),
        isGenerated: generated.isGenerated,
        generatedReason: generated.reason,
        isBinary: false,
        addedLineCount: 0,
        deletedLineCount: 0,
        hunks: [],
      });
    }

    if (workingTree.isDirty) {
      warnings.push(
        'Working-tree changes are included (source: "working-tree"); they are uncommitted and not part of the branch history. For a path changed both on the branch and in the working tree, the working-tree content takes precedence. Untracked files are listed but their line counts are not measured.',
      );
    }
  } else {
    const branchDiff = (
      await git([...DIFF_FLAGS, compareRef, "HEAD"], state.repositoryRoot)
    ).stdout;
    files = parseUnifiedDiff(branchDiff).map((parsed) =>
      toInventoryFile(parsed, "branch"),
    );

    if (workingTree.isDirty) {
      warnings.push(
        "The working tree has uncommitted changes that are NOT included. Pass --include-working-tree to include them.",
      );
    }
  }

  if (ahead === 0 && files.length === 0 && !workingTree.isDirty) {
    warnings.push(
      `No changes were found between "${resolvedBase.ref}" and HEAD.`,
    );
  }

  return {
    repositoryRoot: state.repositoryRoot,
    repositoryName: state.repositoryName,
    currentBranch: state.currentBranch,
    detachedHead: state.detachedHead,
    headCommit: state.headCommit,
    isShallow: state.isShallow,
    base: {
      ref: resolvedBase.ref,
      source: resolvedBase.source,
      mergeBase,
      ahead,
      behind,
    },
    workingTree: {
      isDirty: workingTree.isDirty,
      included: includeWorkingTree,
      changedPaths: workingTree.changedPaths,
    },
    files,
    warnings,
  };
}
