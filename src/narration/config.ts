/**
 * Resolves the narration configuration using the documented precedence (Phase 4 §1):
 *
 *   1. CLI flags               (highest)
 *   2. `.explain-branch.json`  → `narration` object
 *   3. `package.json`          → `explainBranch.narration` object
 *   4. environment             → `EXPLAIN_BRANCH_TTS_*` variables
 *   5. built-in defaults       (lowest)
 *
 * The resolved config is validated for model/voice/format compatibility before use, so an
 * invalid combination fails with an actionable message instead of a provider error.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_NARRATION_CONFIG,
  SUPPORTED_PROVIDERS,
  modelSupportsInstructions,
  validateNarrationConfig,
  type NarrationConfig,
  type NarrationProvider,
  type SpeechFormat,
} from "./types.ts";

export const NARRATION_CONFIG_FILE = ".explain-branch.json";
export const NARRATION_ENV_PREFIX = "EXPLAIN_BRANCH_TTS_";

/** The layer a resolved field came from, in precedence order (highest first). */
export type NarrationConfigSource =
  | "cli"
  | "config"
  | "package"
  | "environment"
  | "default";

/** Raw, unvalidated overrides; every field is a string as supplied by the user. */
export interface NarrationConfigOverrides {
  provider?: string;
  model?: string;
  voice?: string;
  instructions?: string;
  format?: string;
}

export interface NarrationConfigLayers {
  cli?: NarrationConfigOverrides | undefined;
  config?: NarrationConfigOverrides | undefined;
  package?: NarrationConfigOverrides | undefined;
  env?: Record<string, string | undefined> | undefined;
}

export interface NarrationConfigResult {
  config: NarrationConfig;
  /** Which layer supplied each resolved field; `default` when nothing overrode it. */
  sources: Record<keyof NarrationConfig, NarrationConfigSource>;
}

/** Raised when the resolved narration configuration is invalid or contradictory. */
export class NarrationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NarrationConfigError";
  }
}

const FIELDS = [
  "provider",
  "model",
  "voice",
  "instructions",
  "format",
] as const;

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Picks the first non-empty value across layers, remembering which layer won. */
function resolveField(
  layers: ReadonlyArray<{
    source: NarrationConfigSource;
    values: NarrationConfigOverrides | undefined;
  }>,
  field: keyof NarrationConfigOverrides,
): { value: string | undefined; source: NarrationConfigSource } {
  for (const layer of layers) {
    const value = normalizeString(layer.values?.[field]);
    if (value !== undefined) return { value, source: layer.source };
  }
  return { value: undefined, source: "default" };
}

function envOverrides(
  env: Record<string, string | undefined> | undefined,
): NarrationConfigOverrides {
  if (env === undefined) return {};
  return {
    provider: normalizeString(env[`${NARRATION_ENV_PREFIX}PROVIDER`]),
    model: normalizeString(env[`${NARRATION_ENV_PREFIX}MODEL`]),
    voice: normalizeString(env[`${NARRATION_ENV_PREFIX}VOICE`]),
    instructions: normalizeString(env[`${NARRATION_ENV_PREFIX}INSTRUCTIONS`]),
    format: normalizeString(env[`${NARRATION_ENV_PREFIX}FORMAT`]),
  };
}

/**
 * Pure precedence resolution. Given the already-read layers, returns the validated config
 * and the source of each field. Throws {@link NarrationConfigError} on invalid input.
 */
export function resolveNarrationConfigFromLayers(
  layers: NarrationConfigLayers,
): NarrationConfigResult {
  const ordered = [
    { source: "cli" as const, values: layers.cli },
    { source: "config" as const, values: layers.config },
    { source: "package" as const, values: layers.package },
    { source: "environment" as const, values: envOverrides(layers.env) },
  ];

  const resolved = Object.fromEntries(
    FIELDS.map((field) => [field, resolveField(ordered, field)]),
  ) as Record<
    keyof NarrationConfigOverrides,
    {
      value: string | undefined;
      source: NarrationConfigSource;
    }
  >;

  const providerValue =
    resolved.provider.value ?? DEFAULT_NARRATION_CONFIG.provider;
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(providerValue)) {
    throw new NarrationConfigError(
      `Unsupported narration provider "${providerValue}". Supported providers: ${SUPPORTED_PROVIDERS.join(", ")}.`,
    );
  }

  const model = resolved.model.value ?? DEFAULT_NARRATION_CONFIG.model;

  // `instructions` only applies to gpt-4o-mini-tts. Keep the default only where it is
  // honoured; an explicit value for an incompatible model is a hard error below.
  const instructionsSource = resolved.instructions.source;
  const instructionsValue = resolved.instructions.value;
  const dropDefaultInstructions =
    instructionsSource === "default" &&
    instructionsValue !== undefined &&
    !modelSupportsInstructions(model);

  const config: NarrationConfig = {
    provider: providerValue as NarrationProvider,
    model,
    voice: resolved.voice.value ?? DEFAULT_NARRATION_CONFIG.voice,
    format: (resolved.format.value ??
      DEFAULT_NARRATION_CONFIG.format) as SpeechFormat,
    ...(instructionsValue !== undefined && !dropDefaultInstructions
      ? { instructions: instructionsValue }
      : {}),
  };

  const errors = validateNarrationConfig(config);
  if (errors.length > 0) {
    throw new NarrationConfigError(
      `Invalid narration configuration:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  return {
    config,
    sources: {
      provider: resolved.provider.value ? resolved.provider.source : "default",
      model: resolved.model.value ? resolved.model.source : "default",
      voice: resolved.voice.value ? resolved.voice.source : "default",
      instructions:
        config.instructions === undefined ? "default" : instructionsSource,
      format: resolved.format.value ? resolved.format.source : "default",
    },
  };
}

function extractOverrides(raw: unknown): NarrationConfigOverrides | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const overrides: NarrationConfigOverrides = {};
  for (const field of FIELDS) {
    const value = normalizeString(record[field]);
    if (value !== undefined) overrides[field] = value;
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/**
 * Reads narration overrides from project configuration files. Missing or malformed files
 * are ignored (they fall through to the next layer), matching the base-ref resolver.
 */
export async function readProjectNarrationConfig(
  repositoryRoot: string,
): Promise<{
  config?: NarrationConfigOverrides;
  package?: NarrationConfigOverrides;
}> {
  const result: {
    config?: NarrationConfigOverrides;
    package?: NarrationConfigOverrides;
  } = {};

  const dotFile = await readJsonIfPresent(
    path.join(repositoryRoot, NARRATION_CONFIG_FILE),
  );
  if (typeof dotFile === "object" && dotFile !== null) {
    const config = extractOverrides(
      (dotFile as { narration?: unknown }).narration,
    );
    if (config !== undefined) result.config = config;
  }

  const packageJson = await readJsonIfPresent(
    path.join(repositoryRoot, "package.json"),
  );
  if (typeof packageJson === "object" && packageJson !== null) {
    const pkg = extractOverrides(
      (packageJson as { explainBranch?: { narration?: unknown } }).explainBranch
        ?.narration,
    );
    if (pkg !== undefined) result.package = pkg;
  }

  return result;
}

export interface ResolveNarrationConfigArgs {
  repositoryRoot: string;
  /** CLI-supplied overrides (highest precedence). */
  overrides?: NarrationConfigOverrides | undefined;
  /** Environment source; defaults to `process.env`. */
  env?: Record<string, string | undefined> | undefined;
}

/** Reads project config, then resolves and validates the effective narration config. */
export async function resolveNarrationConfig(
  args: ResolveNarrationConfigArgs,
): Promise<NarrationConfigResult> {
  const project = await readProjectNarrationConfig(args.repositoryRoot);
  return resolveNarrationConfigFromLayers({
    cli: args.overrides,
    config: project.config,
    package: project.package,
    env: args.env ?? process.env,
  });
}
