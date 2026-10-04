import test from "node:test";
import assert from "node:assert/strict";
import {
  CredentialRejectedError,
  MissingCredentialError,
  OPENAI_API_KEY_ENV,
  describeCredentialFailure,
  isAuthenticationError,
  readOpenAiApiKey,
  redactSecret,
} from "../../src/narration/credentials.ts";

test("missing key throws a clear setup error", () => {
  assert.throws(
    () => readOpenAiApiKey({}),
    (error: unknown) => {
      assert.ok(error instanceof MissingCredentialError);
      assert.match(error.message, new RegExp(OPENAI_API_KEY_ENV));
      assert.match(error.message, /not set/);
      return true;
    },
  );
});

test("blank key is treated as missing", () => {
  assert.throws(
    () => readOpenAiApiKey({ [OPENAI_API_KEY_ENV]: "   " }),
    MissingCredentialError,
  );
});

test("returns the trimmed key when present", () => {
  assert.equal(
    readOpenAiApiKey({ [OPENAI_API_KEY_ENV]: "  sk-test-123  " }),
    "sk-test-123",
  );
});

test("recognises authentication errors by status", () => {
  assert.equal(isAuthenticationError({ status: 401 }), true);
  assert.equal(isAuthenticationError({ status: 403 }), true);
  assert.equal(isAuthenticationError({ status: 429 }), false);
  assert.equal(isAuthenticationError(new Error("boom")), false);
  assert.equal(isAuthenticationError(undefined), false);
});

test("maps rejected credentials to a non-secret error", () => {
  const mapped = describeCredentialFailure({ status: 401 });
  assert.ok(mapped instanceof CredentialRejectedError);
  assert.match(mapped.message, /rejected/);
  assert.match(mapped.message, new RegExp(OPENAI_API_KEY_ENV));

  const missing = describeCredentialFailure(new MissingCredentialError());
  assert.ok(missing instanceof MissingCredentialError);

  const other = describeCredentialFailure(new Error("network down"));
  assert.equal(other.message, "network down");
});

test("redaction never reveals the secret", () => {
  assert.equal(redactSecret(undefined), "<unset>");
  assert.equal(redactSecret(""), "<unset>");
  const redacted = redactSecret("sk-proj-abcdef123456");
  assert.equal(redacted, "sk-***");
  assert.ok(!redacted.includes("abcdef"));
});
