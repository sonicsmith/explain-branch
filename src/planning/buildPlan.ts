import type {
  ChangeInventory,
  InventoryFile,
} from "../analysis/buildChangeInventory.ts";
import {
  captureSourceSnapshot,
  type SourceSnapshot,
} from "../analysis/sourceSnapshot.ts";
import type { DiffHunk } from "../git/parseDiff.ts";
import {
  PLAN_SCHEMA_VERSION,
  type CodeHighlight,
  type ExplainerPlan,
  type ExplainerScene,
  type PlanOmission,
  type SceneVisual,
  type SourceLocation,
} from "./types.ts";

export interface BuildPlanOptions {
  repositoryRoot: string;
  inventory: ChangeInventory;
  /** Total scenes including the closing summary. Defaults to 5. */
  maxScenes?: number;
  /** Overrides the generation timestamp (used for deterministic tests). */
  generatedAt?: string;
  /** Reuse a previously captured snapshot instead of reading the repository again. */
  snapshot?: SourceSnapshot;
}

export interface BuildPlanResult {
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

/** Declaration patterns used to name the symbols a change introduces or removes. */
const DECLARATION_PATTERNS: readonly RegExp[] = [
  /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /\bclass\s+([A-Za-z_$][\w$]*)/,
  /\bexport\s+interface\s+([A-Za-z_$][\w$]*)/,
  /\binterface\s+([A-Za-z_$][\w$]*)/,
  /\bexport\s+type\s+([A-Za-z_$][\w$]*)/,
  /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
  /\bdef\s+([A-Za-z_][\w]*)/,
  /\bfunc\s+([A-Za-z_][\w]*)/,
  /\bfn\s+([A-Za-z_][\w]*)/,
];

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

export function collectSymbols(
  hunks: readonly DiffHunk[],
  sign: "+" | "-",
): string[] {
  const found: string[] = [];
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (!line.startsWith(sign)) continue;
      const text = line.slice(1);
      for (const pattern of DECLARATION_PATTERNS) {
        const match = pattern.exec(text);
        const name = match?.[1];
        if (name !== undefined) {
          if (!found.includes(name)) found.push(name);
          break;
        }
      }
      if (found.length >= 5) return found;
    }
  }
  return found;
}

function formatList(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

function symbolSentence(file: InventoryFile, sign: "+" | "-"): string {
  const symbols = collectSymbols(file.hunks, sign);
  if (symbols.length === 0) return "";
  const verb = sign === "+" ? "introduces or updates" : "removes";
  return ` It ${verb} ${formatList(symbols)}.`;
}

function describeFile(file: InventoryFile): string {
  if (file.isBinary) {
    return `${file.path} is a binary file that changed.`;
  }

  const language = file.language === "unknown" ? "" : ` ${file.language}`;

  switch (file.changeType) {
    case "added":
      return `A new${language} file, ${file.path}, adds ${file.addedLineCount} line(s).${symbolSentence(file, "+")}`;
    case "deleted":
      return `${file.path} is deleted, removing ${file.deletedLineCount} line(s).${symbolSentence(file, "-")}`;
    case "renamed":
      return `${file.oldPath ?? "a file"} is renamed to ${file.path}.${symbolSentence(file, "+")}`;
    case "copied":
      return `${file.oldPath ?? "a file"} is copied to ${file.path}.${symbolSentence(file, "+")}`;
    case "type-changed":
      return `The file type of ${file.path} changed.`;
    default:
      return `${file.path} is modified, with ${file.addedLineCount} line(s) added and ${file.deletedLineCount} removed.${symbolSentence(file, "+")}`;
  }
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

function buildGroupNarration(group: Group): string {
  const files = group.files;
  const sentences: string[] = [
    `This change updates ${files.length} file${files.length === 1 ? "" : "s"} under ${whereLabel(group.key)}.`,
  ];

  for (const file of files.slice(0, 4)) {
    sentences.push(describeFile(file));
  }

  if (files.length > 4) {
    sentences.push(
      `${files.length - 4} further file(s) changed here and are not walked through individually.`,
    );
  }

  return sentences.join(" ");
}

function buildGroupScene(
  group: Group,
  index: number,
  snapshot: SourceSnapshot,
): ExplainerScene {
  const locations = buildLocations(group.files, snapshot);
  return {
    id: `scene-${index + 1}`,
    title: `Changes in ${whereLabel(group.key)}`,
    purpose: `Show the code that changed in ${whereLabel(group.key)} and what the edits do.`,
    narrationText: buildGroupNarration(group),
    visual: chooseVisual(group.files),
    sourceLocations: locations,
    highlights: buildHighlights(group.files, locations),
  };
}

function countByChangeType(
  files: readonly InventoryFile[],
): Record<string, number> {
  const counts: Record<string, number> = {
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
  };
  for (const file of files) {
    counts[file.changeType] = (counts[file.changeType] ?? 0) + 1;
  }
  return counts;
}

function buildSummaryScene(
  inventory: ChangeInventory,
  ranked: readonly Group[],
  omissionCount: number,
): ExplainerScene {
  const files = inventory.files.filter((file) => !file.isGenerated);
  const counts = countByChangeType(files);
  const added = files.reduce((total, file) => total + file.addedLineCount, 0);
  const deleted = files.reduce(
    (total, file) => total + file.deletedLineCount,
    0,
  );

  const sentences: string[] = [];
  sentences.push(
    `Branch "${branchNameOf(inventory)}" changes ${inventory.files.length} file(s) relative to "${inventory.base?.ref ?? "(unresolved)"}"`,
  );
  sentences.push(
    `(${counts.added ?? 0} added, ${counts.modified ?? 0} modified, ${counts.deleted ?? 0} deleted, ${counts.renamed ?? 0} renamed)`,
  );
  sentences.push(`totalling ${added} line(s) added and ${deleted} removed.`);

  const areas = ranked.slice(0, 3).map((group) => whereLabel(group.key));
  if (areas.length > 0) {
    sentences.push(`The main areas are ${formatList(areas)}.`);
  }
  if (omissionCount > 0) {
    sentences.push(
      `${omissionCount} changed file(s) are not covered in detail.`,
    );
  }

  return {
    id: "summary",
    title: "Summary",
    purpose: "Summarise the branch and what it changes.",
    narrationText: sentences.join(" "),
    visual: "summary",
    sourceLocations: [],
    highlights: [],
  };
}

function branchNameOf(inventory: ChangeInventory): string {
  if (inventory.currentBranch !== null) return inventory.currentBranch;
  return inventory.detachedHead ? "detached HEAD" : "unknown";
}

function buildCaveats(inventory: ChangeInventory): string[] {
  const caveats: string[] = [
    "Narration is derived mechanically from the diff; it describes what changed, not why.",
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
 * Turns a change inventory into a validated-shape scene plan. Deterministic: the same
 * inventory and `generatedAt` produce an identical plan. The planner only makes claims it
 * can ground in the diff (paths, counts, change types, declared symbol names).
 */
export async function buildPlan(
  options: BuildPlanOptions,
): Promise<BuildPlanResult> {
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
  scenes.push(buildSummaryScene(inventory, ranked, dedupedOmissions.length));

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
