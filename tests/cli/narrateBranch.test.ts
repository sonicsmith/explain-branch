import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TempRepo } from "../helpers/tempRepo.ts";

const CLI = fileURLToPath(
  new URL("../../src/cli/narrateBranch.ts", import.meta.url),
);

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<CliRun> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { env, encoding: "utf8" },
      (error, stdout, stderr) => {
        const rawCode = (error as { code?: unknown } | null)?.code;
        const code =
          error === null ? 0 : typeof rawCode === "number" ? rawCode : 1;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

function planJson(): string {
  return JSON.stringify({
    schemaVersion: 3,
    title: "CLI test",
    repositoryName: "repo",
    branchName: "feature/x",
    baseRef: "main",
    generatedAt: "2020-01-01T00:00:00Z",
    scenes: [
      {
        id: "scene-1",
        title: "One",
        purpose: "p",
        narrationText: "A single short scene.",
        visual: "summary",
        sourceLocations: [],
        highlights: [],
      },
    ],
    omissions: [],
    caveats: [],
  });
}

function envWithoutKey(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  return env;
}

test("exits non-zero with a clear message when OPENAI_API_KEY is missing", async () => {
  const repo = await TempRepo.create();
  try {
    await repo.write("artifacts/branch-plan.json", planJson());

    const result = await runCli(["--repo", repo.dir], envWithoutKey());

    assert.equal(result.code, 4, `stderr: ${result.stderr}`);
    assert.match(result.stderr, /OPENAI_API_KEY/);
    assert.match(result.stderr, /not set/);
    // It must not claim to have narrated anything.
    assert.doesNotMatch(result.stdout, /Narrated:/);
  } finally {
    await repo.cleanup();
  }
});

test("a dry run needs no credentials and exits 0", async () => {
  const repo = await TempRepo.create();
  try {
    await repo.write("artifacts/branch-plan.json", planJson());

    const result = await runCli(
      ["--repo", repo.dir, "--dry-run"],
      envWithoutKey(),
    );

    assert.equal(result.code, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /Dry run/);
    assert.match(result.stdout, /No audio was generated/);
  } finally {
    await repo.cleanup();
  }
});
