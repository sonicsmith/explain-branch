import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  NarrationConfigError,
  NARRATION_ENV_PREFIX,
  readProjectNarrationConfig,
  resolveNarrationConfig,
  resolveNarrationConfigFromLayers,
} from "../../src/narration/config.ts";

test("falls back to built-in defaults", () => {
  const { config, sources } = resolveNarrationConfigFromLayers({});
  assert.equal(config.provider, "openai");
  assert.equal(config.model, "gpt-4o-mini-tts");
  assert.equal(config.voice, "marin");
  assert.equal(config.format, "wav");
  assert.equal(sources.model, "default");
  assert.equal(sources.format, "default");
});

test("precedence is cli > config > package > environment > default", () => {
  const { config, sources } = resolveNarrationConfigFromLayers({
    cli: { voice: "cedar" },
    config: { voice: "alloy", model: "tts-1" },
    package: { voice: "echo", model: "tts-1-hd", format: "mp3" },
    env: { [`${NARRATION_ENV_PREFIX}VOICE`]: "nova" },
  });

  // voice comes from the CLI layer
  assert.equal(config.voice, "cedar");
  assert.equal(sources.voice, "cli");
  // model comes from the .explain-branch.json layer
  assert.equal(config.model, "tts-1");
  assert.equal(sources.model, "config");
  // format comes from package.json
  assert.equal(config.format, "mp3");
  assert.equal(sources.format, "package");
});

test("environment overrides defaults but not project config", () => {
  const env = {
    [`${NARRATION_ENV_PREFIX}MODEL`]: "tts-1-hd",
    [`${NARRATION_ENV_PREFIX}VOICE`]: "alloy",
  };
  const fromEnv = resolveNarrationConfigFromLayers({ env });
  assert.equal(fromEnv.config.model, "tts-1-hd");
  assert.equal(fromEnv.sources.model, "environment");

  const overridden = resolveNarrationConfigFromLayers({
    config: { model: "gpt-4o-mini-tts" },
    env,
  });
  assert.equal(overridden.config.model, "gpt-4o-mini-tts");
  assert.equal(overridden.sources.model, "config");
});

test("rejects a voice the chosen model does not support", () => {
  assert.throws(
    () =>
      resolveNarrationConfigFromLayers({
        cli: { model: "tts-1", voice: "marin" },
      }),
    (error: unknown) => {
      assert.ok(error instanceof NarrationConfigError);
      assert.match(error.message, /not supported by model "tts-1"/);
      assert.match(error.message, /alloy/);
      return true;
    },
  );
});

test("rejects an unsupported audio format", () => {
  assert.throws(
    () => resolveNarrationConfigFromLayers({ cli: { format: "ogg" } }),
    /Unsupported audio format "ogg"/,
  );
});

test("rejects an unsupported provider", () => {
  assert.throws(
    () => resolveNarrationConfigFromLayers({ cli: { provider: "elevenlabs" } }),
    /Unsupported narration provider "elevenlabs"/,
  );
});

test("explicit instructions are rejected for models that ignore them", () => {
  assert.throws(
    () =>
      resolveNarrationConfigFromLayers({
        cli: { model: "tts-1", voice: "alloy", instructions: "Whisper." },
      }),
    /does not support "instructions"/,
  );
});

test("the default instructions are dropped for models that ignore them", () => {
  const { config } = resolveNarrationConfigFromLayers({
    cli: { model: "tts-1", voice: "alloy" },
  });
  assert.equal(config.instructions, undefined);
});

test("reads .explain-branch.json and package.json narration blocks", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "explain-branch-cfg-"));
  try {
    await writeFile(
      path.join(dir, ".explain-branch.json"),
      JSON.stringify({ narration: { voice: "sage" } }),
      "utf8",
    );
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ explainBranch: { narration: { model: "tts-1-hd" } } }),
      "utf8",
    );

    const project = await readProjectNarrationConfig(dir);
    assert.deepEqual(project.config, { voice: "sage" });
    assert.deepEqual(project.package, { model: "tts-1-hd" });

    const resolved = await resolveNarrationConfig({
      repositoryRoot: dir,
      overrides: { voice: "alloy" },
      env: {},
    });
    assert.equal(resolved.config.model, "tts-1-hd");
    assert.equal(resolved.config.voice, "alloy");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ignores malformed project config files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "explain-branch-cfg-"));
  try {
    await writeFile(
      path.join(dir, ".explain-branch.json"),
      "{ not json",
      "utf8",
    );
    const project = await readProjectNarrationConfig(dir);
    assert.equal(project.config, undefined);

    const resolved = await resolveNarrationConfig({
      repositoryRoot: dir,
      env: {},
    });
    assert.equal(resolved.config.model, "gpt-4o-mini-tts");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
