/**
 * Credential handling for narration (Phase 4 §1).
 *
 * Rules (see ADR 0002, Decision 1):
 * - Read `OPENAI_API_KEY` from the environment **only** — never from the repository.
 * - A missing/rejected key must stop with a clear setup message and a non-zero exit; the
 *   pipeline must never claim narration is available.
 * - Never write the key to logs, the plan, the video, or captions.
 */

export const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";

/** Raised when no API key is present in the environment. */
export class MissingCredentialError extends Error {
  constructor() {
    super(
      `Narration requires the ${OPENAI_API_KEY_ENV} environment variable, but it is not set.\n` +
        `Set it in your shell (do not commit it) and re-run, for example:\n` +
        `  export ${OPENAI_API_KEY_ENV}=sk-...\n` +
        `No narration audio was generated.`,
    );
    this.name = "MissingCredentialError";
  }
}

/** Raised when the provider rejects the supplied credentials (HTTP 401/403). */
export class CredentialRejectedError extends Error {
  constructor() {
    super(
      `The TTS provider rejected the ${OPENAI_API_KEY_ENV} credentials (authentication failed).\n` +
        `Check that the key is valid and has access to the Text-to-Speech API, then re-run.\n` +
        `No narration audio was generated.`,
    );
    this.name = "CredentialRejectedError";
  }
}

/**
 * Returns the trimmed API key from the environment, or throws
 * {@link MissingCredentialError} when it is absent or blank.
 */
export function readOpenAiApiKey(
  env: Record<string, string | undefined> = process.env,
): string {
  const value = env[OPENAI_API_KEY_ENV];
  if (typeof value !== "string" || value.trim() === "") {
    throw new MissingCredentialError();
  }
  return value.trim();
}

interface StatusLike {
  status?: unknown;
}

/** True for provider errors that indicate the credentials were rejected (401/403). */
export function isAuthenticationError(error: unknown): boolean {
  const status = (error as StatusLike | null | undefined)?.status;
  return status === 401 || status === 403;
}

/**
 * Converts any credential failure into a clear, non-secret error. Missing credentials are
 * reported as {@link MissingCredentialError}; rejected ones as {@link CredentialRejectedError}.
 */
export function describeCredentialFailure(error: unknown): Error {
  if (error instanceof MissingCredentialError) return error;
  if (
    error instanceof CredentialRejectedError ||
    isAuthenticationError(error)
  ) {
    return new CredentialRejectedError();
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Returns a log-safe representation of a secret: the scheme prefix plus a fixed mask. Never
 * returns any part of the original value.
 */
export function redactSecret(secret: string | undefined): string {
  if (secret === undefined || secret.trim() === "") return "<unset>";
  const prefix = secret.includes("-") ? `${secret.split("-")[0]}-` : "";
  return `${prefix}***`;
}
