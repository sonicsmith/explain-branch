/**
 * Retry policy for TTS calls (Phase 4 §5).
 *
 * Only transient failures are retried: HTTP 429 (rate limit) and 5xx, plus network errors.
 * Rate-limit delays honour `Retry-After` as a minimum. Client errors that need user action
 * (400, 401/403, 404, …) are **not** retried. The OpenAI SDK's own retries are disabled
 * (`maxRetries: 0`) so the two loops cannot multiply requests.
 */
import {
  CredentialRejectedError,
  MissingCredentialError,
} from "./credentials.ts";
import { isRetryableStatus, retryAfterMs } from "./limits.ts";

export interface RetryPolicy {
  /** Total attempts including the first. */
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  /** Exponential base. */
  factor: number;
  /** Random jitter as a fraction of the delay (0–1). */
  jitter: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  initialDelayMs: 500,
  maxDelayMs: 20000,
  factor: 2,
  jitter: 0.25,
};

interface ErrorLike {
  status?: unknown;
  name?: unknown;
  code?: unknown;
  headers?: unknown;
}

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** True when an error is worth retrying. Credential and client errors are not. */
export function isRetryableError(error: unknown): boolean {
  if (
    error instanceof MissingCredentialError ||
    error instanceof CredentialRejectedError
  ) {
    return false;
  }

  const candidate = error as ErrorLike | null | undefined;
  const status = candidate?.status;
  if (typeof status === "number") return isRetryableStatus(status);

  const name = candidate?.name;
  if (name === "APIConnectionError" || name === "APIConnectionTimeoutError") {
    return true;
  }

  const code = candidate?.code;
  if (typeof code === "string" && NETWORK_CODES.has(code)) return true;

  // A failed fetch surfaces as a TypeError with a network message.
  return error instanceof TypeError;
}

function retryAfterFromError(error: unknown): number | null {
  const headers = (error as ErrorLike | null | undefined)?.headers;
  if (headers === null || headers === undefined) return null;
  const get = (headers as { get?: unknown }).get;
  if (typeof get !== "function") return null;
  return retryAfterMs(headers as { get(name: string): string | null });
}

/** Backoff for the given 1-based attempt, capped and jittered, never below `Retry-After`. */
export function computeRetryDelayMs(
  attempt: number,
  policy: RetryPolicy,
  error: unknown,
  random: () => number = Math.random,
): number {
  const exponential = policy.initialDelayMs * policy.factor ** (attempt - 1);
  const capped = Math.min(policy.maxDelayMs, exponential);
  const jittered = capped * (1 + (random() * 2 - 1) * policy.jitter);
  const backoff = Math.max(0, Math.round(jittered));
  const retryAfter = retryAfterFromError(error);
  return retryAfter !== null ? Math.max(retryAfter, backoff) : backoff;
}

export interface RetryHooks {
  /** Injected for tests (defaults to `setTimeout`). */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for deterministic jitter. */
  random?: () => number;
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => void;
}

/** Runs `operation`, retrying transient failures per the policy with exponential backoff. */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  hooks: RetryHooks = {},
): Promise<T> {
  const sleep =
    hooks.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = hooks.random ?? Math.random;

  let attempt = 1;
  for (;;) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= policy.maxAttempts || !isRetryableError(error)) {
        throw error;
      }
      const delayMs = computeRetryDelayMs(attempt, policy, error, random);
      hooks.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
      attempt += 1;
    }
  }
}
