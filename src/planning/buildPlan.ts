import type {
  ChangeInventory,
  InventoryFile,
} from "../analysis/buildChangeInventory.ts";
import {
  captureSourceSnapshot,
  type SourceSnapshot,
} from "../analysis/sourceSnapshot.ts";
import {
  PLAN_SCHEMA_VERSION,
  type CodeHighlight,
  type ExplainerPlan,
  type ExplainerScene,
  type PlanOmission,
  type SceneChange,
  type SceneStep,
  type SceneVisual,
  type SourceLocation,
} from "./types.ts";

export interface BuildPlanScaffoldOptions {
  repositoryRoot: string;
  inventory: ChangeInventory;
  /** Total scenes including the closing summary. Defaults to 5. */
  maxScenes?: number;
  /** Overrides the generation timestamp (used for deterministic tests). */
  generatedAt?: string;
  /** Reuse a previously captured snapshot instead of reading the repository again. */
  snapshot?: SourceSnapshot;
}

export interface BuildPlanScaffoldResult {
  plan: ExplainerPlan;
  snapshot: SourceSnapshot;
}

interface Group {
  key: string;
  files: InventoryFile[];
  score: number;
}

const DOC_LANGUAGES = new Set(["markdown", "text"]);
const CONFIG_LANGUAGES = new Set(["json", "jsonc", "yaml", "toml", "ini"]);

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/** Directory-based group key; files at the repository root group under ".". */
export function groupKey(filePath: string): string {
  const normalized = normalize(filePath);
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? "." : normalized.slice(0, slash) || ".";
}

/** Coarser key (first path segment) used when there are more directories than scenes. */
export function coarseGroupKey(filePath: string): string {
  const normalized = normalize(filePath);
  const slash = normalized.indexOf("/");
  return slash === -1 ? "." : normalized.slice(0, slash) || ".";
}

function isTestFile(filePath: string): boolean {
  const normalized = normalize(filePath);
  return (
    /(^|\/)(tests?|__tests__|spec)\//.test(normalized) ||
    /\.(test|spec)\.[a-z]+$/.test(normalized)
  );
}

function magnitude(file: InventoryFile): number {
  if (file.isBinary) return 40;
  return file.addedLineCount + file.deletedLineCount;
}

function weight(file: InventoryFile): number {
  if (isTestFile(file.path)) return 0.6;
  if (DOC_LANGUAGES.has(file.language)) return 0.4;
  if (CONFIG_LANGUAGES.has(file.language)) return 0.5;
  return 1;
}

function scoreGroup(files: readonly InventoryFile[]): number {
  let score = files.length;
  for (const file of files) {
    score += magnitude(file) * weight(file);
  }
  return Math.round(score * 100) / 100;
}

function whereLabel(key: string): string {
  return key === "." ? "the repository root" : key;
}

function chooseVisual(files: readonly InventoryFile[]): SceneVisual {
  const hasWalkthroughCode = files.some(
    (file) =>
      !file.isBinary &&
      file.hunks.length > 0 &&
      (file.changeType === "added" ||
        file.changeType === "modified" ||
        file.changeType === "renamed"),
  );
  return hasWalkthroughCode ? "code-walkthrough" : "diff";
}

function buildLocations(
  files: readonly InventoryFile[],
  snapshot: SourceSnapshot,
  limit = 3,
): SourceLocation[] {
  const locations: SourceLocation[] = [];

  for (const file of files) {
    if (locations.length >= limit) break;
    if (file.changeType === "deleted" || file.isBinary) continue;
    if (!snapshot.has(file.path)) continue;

    const lineCount = snapshot.lineCount(file.path);
    if (lineCount === 0) continue;

    const starts: number[] = [];
    const ends: number[] = [];
    for (const hunk of file.hunks) {
      const start = hunk.newStart >= 1 ? hunk.newStart : 1;
      const end =
        hunk.newStart >= 1
          ? hunk.newStart + Math.max(hunk.newLineCount, 1) - 1
          : 1;
      starts.push(start);
      ends.push(end);
    }

    const rawStart = starts.length > 0 ? Math.min(...starts) : 1;
    const rawEnd = ends.length > 0 ? Math.max(...ends) : rawStart;
    const startLine = Math.max(1, Math.min(rawStart, lineCount));
    const endLine = Math.max(startLine, Math.min(rawEnd, lineCount));

    locations.push({ file: file.path, startLine, endLine });
  }

  return locations;
}

function buildHighlights(
  files: readonly InventoryFile[],
  locations: readonly SourceLocation[],
  limit = 6,
): CodeHighlight[] {
  const highlights: CodeHighlight[] = [];

  for (const location of locations) {
    const file = files.find((candidate) => candidate.path === location.file);
    if (file === undefined) continue;

    for (const hunk of file.hunks) {
      for (const range of hunk.addedRanges) {
        if (highlights.length >= limit) return highlights;
        if (
          range.startLine >= location.startLine &&
          range.endLine <= location.endLine
        ) {
          highlights.push({
            startLine: range.startLine,
            endLine: range.endLine,
          });
        }
      }
    }
  }

  return highlights;
}

function toSceneChange(file: InventoryFile): SceneChange {
  return {
    path: file.path,
    oldPath: file.oldPath ?? undefined,
    changeType: file.changeType,
    language: file.language,
    addedLines: file.addedLineCount,
    deletedLines: file.deletedLineCount,
    isBinary: file.isBinary,
    isGenerated: file.isGenerated,
  };
}

/**
 * Suggests walkthrough steps for a scene: one step per contiguous run of added lines that
 * falls inside a source location. The narration is left blank — the author fills it in by
 * reading the code. This is the scaffold, not the final plan.
 */
function buildSteps(
  files: readonly InventoryFile[],
  locations: readonly SourceLocation[],
  limit = 6,
): SceneStep[] {
  const steps: SceneStep[] = [];

  for (const location of locations) {
    const file = files.find((candidate) => candidate.path === location.file);
    if (file === undefined) continue;

    for (const hunk of file.hunks) {
      for (const range of hunk.addedRanges) {
        if (steps.length >= limit) return steps;
        if (
          range.startLine >= location.startLine &&
          range.endLine <= location.endLine
        ) {
          steps.push({
            narration: "",
            file: location.file,
            startLine: range.startLine,
            endLine: range.endLine,
          });
        }
      }
    }
  }

  return steps;
}

function buildGroupScene(
  group: Group,
  index: number,
  snapshot: SourceSnapshot,
): ExplainerScene {
  const locations = buildLocations(group.files, snapshot);
  const steps = buildSteps(group.files, locations);
  return {
    id: `scene-${index + 1}`,
    title: `Changes in ${whereLabel(group.key)}`,
    purpose: `Explain the code that changed in ${whereLabel(group.key)}.`,
    // Left blank: the narration is authored later — by the CLI's authoring stage, or by
    // whoever writes the plan passed to `--plan`.
    narrationText: "",
    visual: chooseVisual(group.files),
    // Cover every location a step references, so step ranges stay inside a source location.
    sourceLocations: locations,
    highlights: buildHighlights(group.files, locations),
    ...(steps.length > 0 ? { steps } : {}),
    changes: group.files.map(toSceneChange),
  };
}

function buildSummaryScene(): ExplainerScene {
  // The scaffold only reserves the summary scene; its narration is authored later.
  return {
    id: "summary",
    title: "Summary",
    purpose: "Summarise the branch and what it changes.",
    narrationText: "",
    visual: "summary",
    sourceLocations: [],
    highlights: [],
    changes: [],
  };
}

function branchNameOf(inventory: ChangeInventory): string {
  if (inventory.currentBranch !== null) return inventory.currentBranch;
  return inventory.detachedHead ? "detached HEAD" : "unknown";
}

function buildCaveats(inventory: ChangeInventory): string[] {
  const caveats: string[] = [
    "Explanations describe what the changed code does, based on inspected source; the author's intent is not inferred.",
    "Only changes relative to the comparison base are covered.",
  ];

  if (inventory.base === null) {
    caveats.push("No comparison base was resolved, so the plan may be empty.");
  }
  if (inventory.workingTree.included) {
    caveats.push(
      "Uncommitted working-tree changes are included and are not part of the branch history.",
    );
  } else if (inventory.workingTree.isDirty) {
    caveats.push("Uncommitted working-tree changes are excluded.");
  }
  if (inventory.detachedHead) {
    caveats.push(
      "HEAD is detached; the plan describes the commit range rather than a named branch.",
    );
  }
  for (const warning of inventory.warnings) {
    caveats.push(warning);
  }

  return [...new Set(caveats)];
}

function groupFiles(
  files: readonly InventoryFile[],
  maxScenes: number,
): Map<string, Group> {
  const build = (
    keyOf: (filePath: string) => string,
  ): Map<string, InventoryFile[]> => {
    const map = new Map<string, InventoryFile[]>();
    for (const file of files) {
      const key = keyOf(file.path);
      const list = map.get(key);
      if (list === undefined) map.set(key, [file]);
      else list.push(file);
    }
    return map;
  };

  let byKey = build(groupKey);
  if (byKey.size > maxScenes) {
    byKey = build(coarseGroupKey);
  }

  const groups = new Map<string, Group>();
  for (const [key, groupFilesList] of byKey) {
    const sorted = [...groupFilesList].sort(
      (a, b) => magnitude(b) - magnitude(a) || a.path.localeCompare(b.path),
    );
    groups.set(key, { key, files: sorted, score: scoreGroup(sorted) });
  }
  return groups;
}

function compareGroups(a: Group, b: Group): number {
  return b.score - a.score || a.key.localeCompare(b.key);
}

function dedupeOmissions(omissions: readonly PlanOmission[]): PlanOmission[] {
  const seen = new Set<string>();
  const result: PlanOmission[] = [];
  for (const omission of omissions) {
    if (seen.has(omission.item)) continue;
    seen.add(omission.item);
    result.push(omission);
  }
  return result;
}

/**
 * Turns a change inventory into a **scaffold** scene plan: deterministic grouping, source
 * locations, and suggested walkthrough steps with all narration left blank. The author fills
 * in the narration by reading the code (see `docs/cli.md`); the planner never invents
 * explanations. Deterministic: the same inventory and `generatedAt` produce an identical
 * scaffold, so the authored plan stays reproducible.
 */
export async function buildPlanScaffold(
  options: BuildPlanScaffoldOptions,
): Promise<BuildPlanScaffoldResult> {
  const { repositoryRoot, inventory } = options;
  const maxScenes = Math.max(1, options.maxScenes ?? 5);
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  const snapshot =
    options.snapshot ??
    (await captureSourceSnapshot(repositoryRoot, inventory.files));

  const explainable = inventory.files.filter((file) => !file.isGenerated);
  const generatedFiles = inventory.files.filter((file) => file.isGenerated);

  const ranked = [...groupFiles(explainable, maxScenes).values()].sort(
    compareGroups,
  );

  // Reserve one scene for the closing summary.
  const sceneBudget = Math.max(0, maxScenes - 1);
  const selected = ranked.slice(0, sceneBudget);
  const unselected = ranked.slice(sceneBudget);

  const scenes: ExplainerScene[] = selected.map((group, index) =>
    buildGroupScene(group, index, snapshot),
  );

  const omissions: PlanOmission[] = [];
  for (const file of generatedFiles) {
    omissions.push({
      item: file.path,
      reason: `generated or non-source file (${file.generatedReason ?? "heuristic match"})`,
    });
  }
  for (const group of unselected) {
    for (const file of group.files) {
      omissions.push({
        item: file.path,
        reason: "lower-ranked change beyond the scene limit",
      });
    }
  }

  const dedupedOmissions = dedupeOmissions(omissions);
  scenes.push(buildSummaryScene());

  const plan: ExplainerPlan = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    title: `Branch explainer: ${branchNameOf(inventory)}`,
    repositoryName: inventory.repositoryName,
    branchName: branchNameOf(inventory),
    baseRef: inventory.base?.ref ?? "(unresolved)",
    generatedAt,
    scenes,
    omissions: dedupedOmissions,
    caveats: buildCaveats(inventory),
  };

  return { plan, snapshot };
}
