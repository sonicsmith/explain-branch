import type { RenderInput } from "../RenderInput.ts";

/**
 * Hand-written fixture plan used to render a deterministic video. It mirrors the shape the
 * authoring stage produces on top of the scaffold: multi-step code scenes with plain-English
 * narration, the self-contained `changes` list, and captured `sources`, so no repository
 * access is required to render it.
 */

const gitTs = [
  "export async function git(",
  "  args: readonly string[],",
  "  cwd: string,",
  "): Promise<GitResult> {",
  '  const fullArgs = ["--no-pager", ...args];',
  "  try {",
  '    return await execFileText("git", fullArgs, { cwd, env: READ_ONLY_GIT_ENV });',
  "  } catch (error) {",
  "    const failure = describeFailure(error);",
  "    throw new GitError(failure.message, args, failure.exitCode);",
  "  }",
  "}",
  "",
].join("\n");

const parseDiffTs = [
  "export function parseUnifiedDiff(diffText: string): ParsedFileDiff[] {",
  '  if (diffText.trim() === "") return [];',
  '  const lines = diffText.split("\\n");',
  "  const files: ParsedFileDiff[] = [];",
  "  let index = 0;",
  "  while (index < lines.length) {",
  '    if (!(lines[index] ?? "").startsWith("diff --git ")) {',
  "      index += 1;",
  "      continue;",
  "    }",
  "    files.push(parseFileBlock(readFileBlock(lines, index)));",
  "  }",
  "  return files;",
  "}",
  "",
].join("\n");

const inventoryTs = [
  "export async function buildChangeInventory(",
  "  options: BuildChangeInventoryOptions = {},",
  "): Promise<ChangeInventory> {",
  "  const startPath = options.repoPath ?? process.cwd();",
  "  const state = await getBranchState(startPath);",
  "  const resolvedBase = await resolveBase({ cwd: state.repositoryRoot, explicit: options.base });",
  "  const mergeBase = await readMergeBase(state.repositoryRoot, resolvedBase.ref);",
  "  const files = parseUnifiedDiff(await readDiff(state.repositoryRoot, mergeBase));",
  "  const workingTree = await readWorkingTreeState(state.repositoryRoot);",
  "  return assembleInventory(state, resolvedBase, files, workingTree);",
  "}",
  "",
].join("\n");

export const sampleInput: RenderInput = {
  options: {
    secondsPerScene: 8,
    fps: 30,
    width: 1920,
    height: 1080,
  },
  sources: {
    "src/git/git.ts": gitTs,
    "src/git/parseDiff.ts": parseDiffTs,
    "src/analysis/buildChangeInventory.ts": inventoryTs,
  },
  plan: {
    schemaVersion: 3,
    title: "Branch explainer: feature/read-only-inspection",
    repositoryName: "explain-branch",
    branchName: "feature/read-only-inspection",
    baseRef: "main",
    generatedAt: "2026-01-01T00:00:00.000Z",
    scenes: [
      {
        id: "scene-1",
        title: "Changes in src/git",
        purpose: "Explain the code that changed in src/git.",
        narrationText:
          "First, the git runner prefixes every command with --no-pager and runs it with a read-only environment. Those are the flags that stop Git from launching a pager or prompting, so inspection never hangs a render. Next, when the command fails it wraps the error in a GitError that carries the original arguments and exit code, so callers can report exactly what ran.",
        visual: "code-walkthrough",
        sourceLocations: [
          { file: "src/git/git.ts", startLine: 1, endLine: 12 },
        ],
        highlights: [
          { startLine: 5, endLine: 5 },
          { startLine: 9, endLine: 9 },
        ],
        steps: [
          {
            narration:
              "First, the git runner prefixes every command with --no-pager and runs it with a read-only environment. Those are the flags that stop Git from launching a pager or prompting, so inspection never hangs a render.",
            file: "src/git/git.ts",
            startLine: 5,
            endLine: 5,
          },
          {
            narration:
              "Next, when the command fails it wraps the error in a GitError that carries the original arguments and exit code, so callers can report exactly what ran.",
            file: "src/git/git.ts",
            startLine: 9,
            endLine: 9,
          },
        ],
        changes: [
          {
            path: "src/git/git.ts",
            changeType: "modified",
            language: "typescript",
            addedLines: 3,
            deletedLines: 1,
            isBinary: false,
            isGenerated: false,
          },
          {
            path: "src/git/parseDiff.ts",
            changeType: "modified",
            language: "typescript",
            addedLines: 2,
            deletedLines: 2,
            isBinary: false,
            isGenerated: false,
          },
        ],
      },
      {
        id: "scene-2",
        title: "Changes in src/analysis",
        purpose: "Explain the code that changed in src/analysis.",
        narrationText:
          "Here the inventory is assembled in one pass: it resolves the branch state, then works out the merge base to compare against. Using the merge base means the video describes only the commits this branch introduced, not unrelated work on the base branch. Finally it reads the changed files from the diff and returns them together with the working-tree state.",
        visual: "code-walkthrough",
        sourceLocations: [
          {
            file: "src/analysis/buildChangeInventory.ts",
            startLine: 1,
            endLine: 11,
          },
        ],
        highlights: [
          { startLine: 5, endLine: 5 },
          { startLine: 8, endLine: 8 },
        ],
        steps: [
          {
            narration:
              "Here the inventory is assembled in one pass: it resolves the branch state, then works out the merge base to compare against.",
            file: "src/analysis/buildChangeInventory.ts",
            startLine: 5,
            endLine: 5,
          },
          {
            narration:
              "Using the merge base means the video describes only the commits this branch introduced, not unrelated work on the base branch.",
            file: "src/analysis/buildChangeInventory.ts",
            startLine: 8,
            endLine: 8,
          },
          {
            narration:
              "Finally it reads the changed files from the diff and returns them together with the working-tree state.",
            file: "src/analysis/buildChangeInventory.ts",
            startLine: 9,
            endLine: 9,
          },
        ],
        changes: [
          {
            path: "src/analysis/buildChangeInventory.ts",
            changeType: "added",
            language: "typescript",
            addedLines: 12,
            deletedLines: 0,
            isBinary: false,
            isGenerated: false,
          },
        ],
      },
      {
        id: "scene-3",
        title: "Changes in src/legacy",
        purpose: "Summarise the removed code in src/legacy.",
        narrationText:
          "The old runner has been deleted. It is shown as a diff rather than as current source, because the code no longer exists on this branch — so the video never implies removed code is still there.",
        visual: "diff",
        sourceLocations: [],
        highlights: [],
        changes: [
          {
            path: "src/legacy/runner.ts",
            changeType: "deleted",
            language: "typescript",
            addedLines: 0,
            deletedLines: 24,
            isBinary: false,
            isGenerated: false,
          },
        ],
      },
      {
        id: "summary",
        title: "Summary",
        purpose: "Summarise the branch and what it changes.",
        narrationText:
          "That covers the main changes: a read-only git runner, a single-pass change inventory built on the merge base, and the removal of the old legacy runner. The inspection code is deliberately side-effect free, so running the explainer never alters your repository.",
        visual: "summary",
        sourceLocations: [],
        highlights: [],
        changes: [],
      },
    ],
    omissions: [
      {
        item: "package-lock.json",
        reason: "generated or non-source file (lockfile)",
      },
    ],
    caveats: [
      "Explanations describe what the changed code does, based on inspected source; the author's intent is not inferred.",
      "Only changes relative to the comparison base are covered.",
    ],
  },
};
