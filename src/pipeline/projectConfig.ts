/**
 * Project-level pipeline configuration (Phase 5 §2).
 *
 * Lets a repository set its pipeline defaults once, at the repo root:
 *
 * - `.explain-branch.json`: `{ "base": "...", "maxScenes": 5, "narration": { ... } }`
 * - `package.json`: `explainBranch: { base, maxScenes, narration }`
 *
 * The `base` default is already applied by the Git inspector (`readConfiguredBase`, plan §6);
 * the narration defaults are applied by `resolveNarrationConfig`. This module adds the
 * remaining staging knob the orchestrator needs — a default `maxScenes` — using the same
 * file shapes and the same "missing or malformed falls through" behaviour.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export const EXPLAIN_CONFIG_FILE = ".explain-branch.json";

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : null;
}

/**
 * Reads a default `maxScenes` from project configuration. Precedence mirrors the base-ref and
 * narration resolvers: `.explain-branch.json` first, then `package.json`. Returns `null` when
 * neither supplies a valid value, so callers fall back to the built-in default.
 */
export async function readConfiguredMaxScenes(
  repositoryRoot: string,
): Promise<number | null> {
  const dotFile = await readJsonIfPresent(
    path.join(repositoryRoot, EXPLAIN_CONFIG_FILE),
  );
  if (typeof dotFile === "object" && dotFile !== null) {
    const value = asPositiveInteger(
      (dotFile as { maxScenes?: unknown }).maxScenes,
    );
    if (value !== null) return value;
  }

  const packageJson = await readJsonIfPresent(
    path.join(repositoryRoot, "package.json"),
  );
  if (typeof packageJson === "object" && packageJson !== null) {
    const value = asPositiveInteger(
      (packageJson as { explainBranch?: { maxScenes?: unknown } }).explainBranch
        ?.maxScenes,
    );
    if (value !== null) return value;
  }

  return null;
}
