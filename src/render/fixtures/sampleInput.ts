import type { RenderInput } from "../RenderInput.ts";

/**
 * Hand-written fixture plan used to render a deterministic silent video in Phase 3. It
 * mirrors the shape produced by `buildPlan`, including the self-contained `changes` list
 * and captured `sources`, so no repository access is required to render it.
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
    showCaptions: true,
  },
  sources: {
    "src/git/git.ts": gitTs,
    "src/git/parseDiff.ts": parseDiffTs,
    "src/analysis/buildChangeInventory.ts": inventoryTs,
  },
  plan: {
    schemaVersion: 2,
    title: "Branch explainer: feature/read-only-inspection",
    repositoryName: "explain-branch",
    branchName: "feature/read-only-inspection",
    baseRef: "main",
    generatedAt: "2026-01-01T00:00:00.000Z",
    scenes: [
      {
        id: "scene-1",
        title: "Changes in src/git",
        purpose: "Show the code that changed in src/git and what the edits do.",
        narrationText:
          "This change updates two files under src/git. git.ts is modified, with three lines added and one removed. It introduces or updates execFileText and describeFailure. parseDiff.ts is modified, with two lines added and two removed.",
        visual: "code-walkthrough",
        sourceLocations: [
          { file: "src/git/git.ts", startLine: 1, endLine: 12 },
        ],
        highlights: [{ startLine: 5, endLine: 7 }],
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
        purpose:
          "Show the code that changed in src/analysis and what the edits do.",
        narrationText:
          "A new file, src/analysis/buildChangeInventory.ts, adds twelve lines. It introduces or updates buildChangeInventory and readMergeBase.",
        visual: "code-walkthrough",
        sourceLocations: [
          {
            file: "src/analysis/buildChangeInventory.ts",
            startLine: 1,
            endLine: 11,
          },
        ],
        highlights: [
          { startLine: 5, endLine: 6 },
          { startLine: 8, endLine: 9 },
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
          "src/legacy/runner.ts is deleted, removing twenty-four lines. The deleted code is summarised as a diff rather than shown as current source.",
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
          'Branch "feature/read-only-inspection" changes 4 file(s) relative to "main" (1 added, 2 modified, 1 deleted, 0 renamed) totalling 17 line(s) added and 27 removed. The main areas are src/git, src/analysis and src/legacy.',
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
      "Narration is derived mechanically from the diff; it describes what changed, not why.",
      "Only changes relative to the comparison base are covered.",
    ],
  },
};
