/**
 * Parser for `git diff` unified output.
 *
 * Deliberately dependency-free and pure: it takes the raw diff text and returns a
 * structured description of each changed file. Line numbers are 1-based and refer to the
 * old file (for deletions) or the new file (for additions).
 */

export type ChangeType =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type-changed"
  | "unknown";

export interface LineRange {
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLineCount: number;
  newStart: number;
  newLineCount: number;
  /** The raw `@@ ... @@` header line. */
  header: string;
  /** 1-based line numbers added in the new file. */
  addedLines: number[];
  /** 1-based line numbers removed from the old file. */
  deletedLines: number[];
  /** Consecutive added lines collapsed into ranges. */
  addedRanges: LineRange[];
  /** Consecutive deleted lines collapsed into ranges. */
  deletedRanges: LineRange[];
  /** Raw hunk body lines, including the leading ' ', '+', '-' or '\'. */
  lines: string[];
}

export interface ParsedFileDiff {
  /** New path for additions/modifications/renames, old path for deletions. */
  path: string;
  /** Previous path for renames/copies, otherwise `null`. */
  oldPath: string | null;
  changeType: ChangeType;
  isBinary: boolean;
  addedLineCount: number;
  deletedLineCount: number;
  hunks: DiffHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Strips Git's `a/`/`b/` prefixes and unquotes C-style quoted paths. */
function normalizePath(raw: string): string {
  let value = raw;
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).replace(/\\(.)/g, (_match, escaped: string) => {
      switch (escaped) {
        case "t":
          return "\t";
        case "n":
          return "\n";
        case "r":
          return "\r";
        default:
          return escaped;
      }
    });
  }

  if (value === "/dev/null") return "";
  return value.replace(/^[ab]\//, "");
}

/** Collapses an ascending list of line numbers into inclusive ranges. */
export function toLineRanges(lines: readonly number[]): LineRange[] {
  const ranges: LineRange[] = [];
  let start: number | null = null;
  let previous: number | null = null;

  for (const line of lines) {
    if (start === null || previous === null || line !== previous + 1) {
      if (start !== null && previous !== null) {
        ranges.push({ startLine: start, endLine: previous });
      }
      start = line;
    }
    previous = line;
  }

  if (start !== null && previous !== null) {
    ranges.push({ startLine: start, endLine: previous });
  }

  return ranges;
}

function emptyHunk(header: string): DiffHunk {
  return {
    oldStart: 0,
    oldLineCount: 0,
    newStart: 0,
    newLineCount: 0,
    header,
    addedLines: [],
    deletedLines: [],
    addedRanges: [],
    deletedRanges: [],
    lines: [],
  };
}

function parseHunk(
  block: readonly string[],
  startIndex: number,
): { hunk: DiffHunk; nextIndex: number } {
  const header = block[startIndex] ?? "";
  const match = HUNK_HEADER.exec(header);

  if (match === null) {
    return { hunk: emptyHunk(header), nextIndex: startIndex + 1 };
  }

  const oldStart = Number(match[1] ?? "0");
  const oldLineCount = match[2] === undefined ? 1 : Number(match[2]);
  const newStart = Number(match[3] ?? "0");
  const newLineCount = match[4] === undefined ? 1 : Number(match[4]);

  const lines: string[] = [];
  const addedLines: number[] = [];
  const deletedLines: number[] = [];

  let oldLine = oldStart;
  let newLine = newStart;
  let index = startIndex + 1;

  while (index < block.length) {
    const line = block[index] ?? "";

    // A blank line only occurs at the end of the diff text; a real empty context line is
    // written by Git as a single space.
    if (
      line === "" ||
      line.startsWith("@@") ||
      line.startsWith("diff --git ")
    ) {
      break;
    }

    if (line.startsWith("+")) {
      addedLines.push(newLine);
      newLine += 1;
    } else if (line.startsWith("-")) {
      deletedLines.push(oldLine);
      oldLine += 1;
    } else if (line.startsWith(" ")) {
      oldLine += 1;
      newLine += 1;
    } else if (!line.startsWith("\\")) {
      // "\ No newline at end of file" is the only other valid marker; anything else means
      // we have left the hunk.
      break;
    }

    lines.push(line);
    index += 1;
  }

  return {
    hunk: {
      oldStart,
      oldLineCount,
      newStart,
      newLineCount,
      header,
      addedLines,
      deletedLines,
      addedRanges: toLineRanges(addedLines),
      deletedRanges: toLineRanges(deletedLines),
      lines,
    },
    nextIndex: index,
  };
}

function parseFileBlock(block: readonly string[]): ParsedFileDiff {
  let oldPath = "";
  let newPath = "";
  let renameFrom: string | null = null;
  let renameTo: string | null = null;
  let isNew = false;
  let isDeleted = false;
  let isRename = false;
  let isCopy = false;
  let isBinary = false;
  let oldMode: string | null = null;
  let newMode: string | null = null;

  const hunks: DiffHunk[] = [];
  let addedLineCount = 0;
  let deletedLineCount = 0;

  let index = 0;
  while (index < block.length) {
    const line = block[index] ?? "";

    if (line.startsWith("@@")) {
      const { hunk, nextIndex } = parseHunk(block, index);
      hunks.push(hunk);
      addedLineCount += hunk.addedLines.length;
      deletedLineCount += hunk.deletedLines.length;
      index = nextIndex;
      continue;
    }

    if (line.startsWith("new file mode ")) {
      isNew = true;
    } else if (line.startsWith("deleted file mode ")) {
      isDeleted = true;
    } else if (line.startsWith("rename from ")) {
      renameFrom = line.slice("rename from ".length);
      isRename = true;
    } else if (line.startsWith("rename to ")) {
      renameTo = line.slice("rename to ".length);
      isRename = true;
    } else if (line.startsWith("copy from ")) {
      renameFrom = line.slice("copy from ".length);
      isCopy = true;
    } else if (line.startsWith("copy to ")) {
      renameTo = line.slice("copy to ".length);
      isCopy = true;
    } else if (line.startsWith("old mode ")) {
      oldMode = line.slice("old mode ".length).trim();
    } else if (line.startsWith("new mode ")) {
      newMode = line.slice("new mode ".length).trim();
    } else if (
      line.startsWith("Binary files ") ||
      line.startsWith("GIT binary patch")
    ) {
      isBinary = true;
    } else if (line.startsWith("--- ")) {
      oldPath = normalizePath(line.slice(4));
    } else if (line.startsWith("+++ ")) {
      newPath = normalizePath(line.slice(4));
    }

    index += 1;
  }

  let path: string;
  let resolvedOldPath: string | null = null;

  if (isRename || isCopy) {
    resolvedOldPath = renameFrom === null ? null : normalizePath(renameFrom);
    path = renameTo === null ? newPath || oldPath : normalizePath(renameTo);
  } else if (isDeleted) {
    path = oldPath || newPath;
    resolvedOldPath = oldPath === "" ? null : oldPath;
  } else {
    path = newPath || oldPath;
  }

  let changeType: ChangeType = "modified";
  if (isNew) {
    changeType = "added";
  } else if (isDeleted) {
    changeType = "deleted";
  } else if (isRename) {
    changeType = "renamed";
  } else if (isCopy) {
    changeType = "copied";
  } else if (oldMode !== null && newMode !== null && oldMode !== newMode) {
    changeType = "type-changed";
  }

  return {
    path,
    oldPath: resolvedOldPath,
    changeType,
    isBinary,
    addedLineCount,
    deletedLineCount,
    hunks,
  };
}

/**
 * Parses the output of a `git diff` invocation into per-file structures. Returns an empty
 * array for empty input.
 */
export function parseUnifiedDiff(diffText: string): ParsedFileDiff[] {
  if (diffText.trim() === "") return [];

  const lines = diffText.split("\n");
  const files: ParsedFileDiff[] = [];

  let index = 0;
  while (index < lines.length) {
    if (!(lines[index] ?? "").startsWith("diff --git ")) {
      index += 1;
      continue;
    }

    index += 1;
    const block: string[] = [];
    while (
      index < lines.length &&
      !(lines[index] ?? "").startsWith("diff --git ")
    ) {
      block.push(lines[index] ?? "");
      index += 1;
    }

    if (block.length > 0) {
      files.push(parseFileBlock(block));
    }
  }

  return files;
}
