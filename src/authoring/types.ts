/**
 * Authoring configuration surface.
 *
 * The CLI authors the narration itself by calling a chat model with the scaffold plan and
 * the relevant source, then merging the returned text back into the plan. This module
 * intentionally has **no** OpenAI SDK import so the config layer stays offline-testable.
 */

/** Default chat model used to author narration. Overridable via flag/config/env. */
export const DEFAULT_AUTHOR_MODEL = "gpt-4o-mini";

export interface AuthorConfig {
  /** OpenAI chat model id used to author the narration. */
  model: string;
}

export const DEFAULT_AUTHOR_CONFIG: AuthorConfig = {
  model: DEFAULT_AUTHOR_MODEL,
};

/** Raised for authoring failures that are neither credential nor validation errors. */
export class AuthorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorError";
  }
}
