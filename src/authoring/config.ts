/**
 * Resolves the authoring configuration using the documented precedence:
 *
 *   1. CLI flag               (highest)  `--author-model`
 *   2. `.explain-branch.json` → `authoring.model`
 *   3. `package.json`         → `explainBranch.authoring.model`
 *   4. environment            → `EXPLAIN_BRANCH_AUTHOR_MODEL`
 *   5. built-in default       (lowest)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_AUTHOR_CONFIG, type AuthorConfig } from "./types.ts";

export const AUTHOR_CONFIG_FILE = ".explain-branch.json";
export const AUTHOR_ENV_PREFIX = "EXPLAIN_BRANCH_AUTHOR_";

/** The layer the model came from, in precedence order (highest first). */
export type AuthorConfigSource =
  | "cli"
  | "config"
  | "package"
  | "environment"
  | "default";

export interface AuthorConfigResult {
  config: AuthorConfig;
  source: AuthorConfigSource;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** Reads the configured authoring model from project configuration files. */
export async function readProjectAuthorModel(
  repositoryRoot: string,
): Promise<{ config?: string; package?: string }> {
  const result: { config?: string; package?: string } = {};

  const dotFile = await readJsonIfPresent(
    path.join(repositoryRoot, AUTHOR_CONFIG_FILE),
  );
  if (typeof dotFile === "object" && dotFile !== null) {
    const model = normalizeString(
      (dotFile as { authoring?: { model?: unknown } }).authoring?.model,
    );
    if (model !== undefined) result.config = model;
  }

  const packageJson = await readJsonIfPresent(
    path.join(repositoryRoot, "package.json"),
  );
  if (typeof packageJson === "object" && packageJson !== null) {
    const model = normalizeString(
      (packageJson as { explainBranch?: { authoring?: { model?: unknown } } })
        .explainBranch?.authoring?.model,
    );
    if (model !== undefined) result.package = model;
  }

  return result;
}

export interface ResolveAuthorConfigArgs {
  repositoryRoot: string;
  /** CLI-supplied model (highest precedence). */
  model?: string | undefined;
  /** Environment source; defaults to `process.env`. */
  env?: Record<string, string | undefined> | undefined;
}

/** Reads project config, then resolves the effective authoring config. */
export async function resolveAuthorConfig(
  args: ResolveAuthorConfigArgs,
): Promise<AuthorConfigResult> {
  const direct = normalizeString(args.model);
  if (direct !== undefined) {
    return { config: { model: direct }, source: "cli" };
  }

  const project = await readProjectAuthorModel(args.repositoryRoot);
  if (project.config !== undefined) {
    return { config: { model: project.config }, source: "config" };
  }
  if (project.package !== undefined) {
    return { config: { model: project.package }, source: "package" };
  }

  const env = args.env ?? process.env;
  const fromEnv = normalizeString(env[`${AUTHOR_ENV_PREFIX}MODEL`]);
  if (fromEnv !== undefined) {
    return { config: { model: fromEnv }, source: "environment" };
  }

  return { config: { ...DEFAULT_AUTHOR_CONFIG }, source: "default" };
}
