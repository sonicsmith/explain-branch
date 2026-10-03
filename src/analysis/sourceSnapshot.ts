import { readFile } from "node:fs/promises";
import path from "node:path";
import { gitOrNull } from "../git/git.ts";
import type { InventoryFile } from "./buildChangeInventory.ts";
import { isSafeRelativePath } from "../planning/paths.ts";

/**
 * A read-only capture of source content used to resolve and verify line references in a
 * plan. Branch changes are captured from HEAD (matching the diff), working-tree changes
 * from disk.
 */
export interface SourceSnapshot {
  has(filePath: string): boolean;
  lineCount(filePath: string): number;
  lines(filePath: string): readonly string[] | null;
  paths(): string[];
}

function splitLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

class Snapshot implements SourceSnapshot {
  private readonly files: Map<string, string[]>;

  constructor(files: Map<string, string[]>) {
    this.files = files;
  }

  has(filePath: string): boolean {
    return this.files.has(filePath);
  }

  lineCount(filePath: string): number {
    return this.files.get(filePath)?.length ?? 0;
  }

  lines(filePath: string): readonly string[] | null {
    return this.files.get(filePath) ?? null;
  }

  paths(): string[] {
    return [...this.files.keys()].sort();
  }
}

/** Builds a snapshot directly from in-memory contents (used by tests and callers). */
export function snapshotFromContents(
  contents: Record<string, string>,
): SourceSnapshot {
  const files = new Map<string, string[]>();
  for (const [filePath, content] of Object.entries(contents)) {
    files.set(filePath, splitLines(content));
  }
  return new Snapshot(files);
}

/**
 * Captures the content of the given inventory entries. Reads only: `git show HEAD:<path>`
 * for committed changes, the working tree for uncommitted ones. Missing files (for
 * example deletions) are simply absent from the snapshot.
 */
export async function captureSourceSnapshot(
  repositoryRoot: string,
  entries: readonly Pick<InventoryFile, "path" | "source">[],
): Promise<SourceSnapshot> {
  const files = new Map<string, string[]>();

  for (const entry of entries) {
    if (files.has(entry.path)) continue;
    if (!isSafeRelativePath(entry.path)) continue;

    if (entry.source === "working-tree") {
      try {
        const content = await readFile(
          path.join(repositoryRoot, entry.path),
          "utf8",
        );
        files.set(entry.path, splitLines(content));
      } catch {
        // Deleted or otherwise unavailable in the working tree; skip.
      }
      continue;
    }

    const result = await gitOrNull(
      ["show", `HEAD:${entry.path}`],
      repositoryRoot,
    );
    if (result !== null) {
      files.set(entry.path, splitLines(result.stdout));
    }
  }

  return new Snapshot(files);
}
