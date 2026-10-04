/**
 * Output overwrite rule (Phase 4 §5, plan §2/§15).
 *
 * The pipeline never silently overwrites an existing output. Callers either opt in with
 * `overwrite: true` or receive a timestamped, non-colliding path. Remotion renders also pass
 * `--overwrite=false`, so a render fails loudly rather than clobbering a previous MP4.
 */
import { stat } from "node:fs/promises";
import path from "node:path";

export interface ResolveOutputPathOptions {
  /** Reuse `desiredPath` even when it exists. */
  overwrite?: boolean;
  /** Injected clock for deterministic tests. */
  now?: () => Date;
}

export interface ResolvedOutputPath {
  /** Path to write to (equal to `desiredPath` unless it was displaced). */
  path: string;
  /** True when `desiredPath` already existed and was displaced. */
  collided: boolean;
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

function formatStamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

/**
 * Resolves a safe output path. With `overwrite: true` the desired path is returned as-is;
 * otherwise an existing file is displaced to `<name>-<UTC timestamp><ext>` (with a counter
 * suffix if that, too, exists).
 */
export async function resolveOutputPath(
  desiredPath: string,
  options: ResolveOutputPathOptions = {},
): Promise<ResolvedOutputPath> {
  const existsAlready = await exists(desiredPath);

  if (options.overwrite === true) {
    return { path: desiredPath, collided: existsAlready };
  }
  if (!existsAlready) {
    return { path: desiredPath, collided: false };
  }

  const stamp = formatStamp((options.now ?? (() => new Date()))());
  const dir = path.dirname(desiredPath);
  const ext = path.extname(desiredPath);
  const base = path.basename(desiredPath, ext);

  let candidate = path.join(dir, `${base}-${stamp}${ext}`);
  let counter = 2;
  while (await exists(candidate)) {
    candidate = path.join(dir, `${base}-${stamp}-${counter}${ext}`);
    counter += 1;
  }
  return { path: candidate, collided: true };
}
