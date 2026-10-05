import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TempRepo } from "../helpers/tempRepo.ts";

const ORCHESTRATOR = fileURLToPath(
  new URL("../../src/cli/explainBranchVideo.ts", import.meta.url),
);
const NARRATE_CLI = fileURLToPath(
  new URL("../../src/cli/narrateBranch.ts", import.meta.url),
);

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(
  cliPath: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
): Promise<CliRun> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cliPath, ...args],
      { env, cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const rawCode = (error as { code?: unknown } | null)?.code;
        const code =
          error === null ? 0 : typeof rawCode === "number" ? rawCode : 1;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

/** Environment for an offline run: fake TTS + a placeholder renderer, no credentials. */
function offlineEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  return {
    ...env,
    EXPLAIN_BRANCH_TEST_FAKE_TTS: "1",
    EXPLAIN_BRANCH_TEST_SKIP_RENDER: "1",
    ...extra,
  };
}

/** Environment with no credentials and no test seams. */
function bareEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.EXPLAIN_BRANCH_TEST_FAKE_TTS;
  delete env.EXPLAIN_BRANCH_TEST_SKIP_RENDER;
  delete env.EXPLAIN_BRANCH_TEST_RENDER_FAIL;
  return env;
}

/** A temp repo with a `feature/x` branch that changes two files relative to `main`. */
async function featureRepo(): Promise<TempRepo> {
  const repo = await TempRepo.create("main");
  await repo.write("src/app.ts", "export const a = 1;\n");
  await repo.commit("base");
  await repo.git(["checkout", "-b", "feature/x"]);
  await repo.write("src/app.ts", "export const a = 2;\nexport const b = 3;\n");
  await repo.write("src/new.ts", "export function added() {\n  return 1;\n}\n");
  await repo.commit("feature change");
  return repo;
}

/**
 * Writes an authored (schema v3) plan — the script never authors narration, so tests must
 * supply one — into the run directory, and returns its path for `--plan`.
 */
async function writeAuthoredPlan(
  repo: TempRepo,
  runId: string,
): Promise<string> {
  const planPath = path.join(repo.dir, "artifacts", runId, "plan.json");
  const plan = {
    schemaVersion: 3,
    title: "Branch explainer: feature/x",
    repositoryName: repo.dir.split("/").pop(),
    branchName: "feature/x",
    baseRef: "main",
    generatedAt: "2026-01-01T00:00:00.000Z",
    scenes: [
      {
        id: "scene-1",
        title: "Changes in src",
        purpose: "Explain the changed code.",
        narrationText:
          "First we add a constant b. Then we export a helper that returns one.",
        visual: "code-walkthrough",
        sourceLocations: [{ file: "src/app.ts", startLine: 1, endLine: 2 }],
        highlights: [{ startLine: 1, endLine: 2 }],
        steps: [
          {
            narration: "First we add a constant b.",
            file: "src/app.ts",
            startLine: 2,
            endLine: 2,
          },
          {
            narration: "Then we export a helper that returns one.",
            file: "src/app.ts",
            startLine: 1,
            endLine: 1,
          },
        ],
        changes: [
          {
            path: "src/app.ts",
            changeType: "modified",
            language: "typescript",
            addedLines: 2,
            deletedLines: 1,
            isBinary: false,
            isGenerated: false,
          },
        ],
      },
      {
        id: "summary",
        title: "Summary",
        purpose: "Summarise the branch.",
        narrationText: "That is the change in this branch.",
        visual: "summary",
        sourceLocations: [],
        highlights: [],
        changes: [],
      },
    ],
    omissions: [],
    caveats: [],
  };
  await mkdir(path.dirname(planPath), { recursive: true });
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return planPath;
}

test("runs the pipeline end to end offline: report, artifacts, no tracked change", async () => {
  const repo = await featureRepo();
  try {
    const authoredPlan = await writeAuthoredPlan(repo, "e2e");
    const result = await runCli(
      ORCHESTRATOR,
      ["--repo", repo.dir, "--run-id", "e2e", "--plan", authoredPlan],
      offlineEnv(),
    );
    assert.equal(result.code, 0, `stderr: ${result.stderr}`);

    const report = JSON.parse(result.stdout) as {
      schemaVersion: number;
      branch: string | null;
      base: { ref: string } | null;
      scenes: number;
      clips: Array<{
        sceneId: string;
        audioPath: string | null;
        durationMs: number | null;
      }>;
      video: { path: string; bytes: number } | null;
      artifacts: {
        planJson: string;
        narrationScript: string;
        renderInput: string;
      };
    };

    assert.equal(report.schemaVersion, 1);
    assert.equal(report.branch, "feature/x");
    assert.equal(report.base?.ref, "main");
    assert.ok(report.scenes >= 1);
    assert.equal(report.clips.length, report.scenes);
    assert.ok(report.video && report.video.bytes > 0);

    // Every advertised artifact exists on disk.
    const runDir = path.join(repo.dir, "artifacts", "e2e");
    for (const file of [
      "plan.json",
      "narration.txt",
      "render-input.json",
      "report.json",
    ]) {
      await stat(path.join(runDir, file));
    }
    await stat(report.artifacts.planJson);
    await stat(report.artifacts.narrationScript);
    await stat(report.artifacts.renderInput);
    await stat(report.video!.path);
    for (const clip of report.clips) {
      assert.ok(clip.audioPath, "clip should record a path");
      assert.ok((clip.durationMs ?? 0) > 0);
      await stat(path.join(repo.dir, clip.audioPath!));
    }

    const script = await readFile(report.artifacts.narrationScript, "utf8");
    assert.match(script, /# Narration script/);

    // No tracked file changed (untracked artifacts are ignored).
    const status = (
      await repo.git(["status", "--porcelain", "--untracked-files=no"])
    ).trim();
    assert.equal(status, "");
  } finally {
    await repo.cleanup();
  }
});

test("ambiguous base exits 2 with an actionable message", async () => {
  const repo = await TempRepo.create("main");
  try {
    await repo.write("a.ts", "export const a = 1;\n");
    await repo.commit("base");
    await repo.git(["branch", "master"]); // both main and master now exist
    await repo.git(["checkout", "-b", "feature"]);
    await repo.write("a.ts", "export const a = 2;\n");
    await repo.commit("change");

    const result = await runCli(
      ORCHESTRATOR,
      ["--repo", repo.dir],
      offlineEnv(),
      repo.dir,
    );
    assert.equal(result.code, 2, `stderr: ${result.stderr}`);
    assert.match(result.stderr, /comparison base/i);
    assert.match(result.stderr, /--base/);
    assert.doesNotMatch(result.stdout, /schemaVersion/);
  } finally {
    await repo.cleanup();
  }
});

test("missing credentials exit 4 before any planning", async () => {
  const repo = await featureRepo();
  try {
    const result = await runCli(
      ORCHESTRATOR,
      ["--repo", repo.dir],
      bareEnv(),
      repo.dir,
    );
    assert.equal(result.code, 4, `stderr: ${result.stderr}`);
    assert.match(result.stderr, /OPENAI_API_KEY/);
    assert.match(result.stderr, /not set/);
    // It must not have produced a video or a run report.
    assert.doesNotMatch(result.stdout, /schemaVersion/);
  } finally {
    await repo.cleanup();
  }
});

test("an unreadable plan exits 3 with the file path", async () => {
  const repo = await featureRepo();
  try {
    await repo.write("artifacts/branch-plan.json", "{ this is not json");
    const result = await runCli(
      NARRATE_CLI,
      ["--repo", repo.dir, "--dry-run"],
      bareEnv(),
      repo.dir,
    );
    assert.equal(result.code, 3, `stderr: ${result.stderr}`);
    assert.match(result.stderr, /could not read the plan/);
    assert.match(result.stderr, /branch-plan\.json/);
  } finally {
    await repo.cleanup();
  }
});

test("an existing output is never silently overwritten", async () => {
  const repo = await featureRepo();
  try {
    const planC1 = await writeAuthoredPlan(repo, "c1");
    const first = await runCli(
      ORCHESTRATOR,
      ["--repo", repo.dir, "--run-id", "c1", "--plan", planC1],
      offlineEnv(),
      repo.dir,
    );
    assert.equal(first.code, 0, `stderr: ${first.stderr}`);

    const planC2 = await writeAuthoredPlan(repo, "c2");
    const second = await runCli(
      ORCHESTRATOR,
      ["--repo", repo.dir, "--run-id", "c2", "--plan", planC2],
      offlineEnv(),
      repo.dir,
    );
    assert.equal(second.code, 0, `stderr: ${second.stderr}`);

    const report = JSON.parse(second.stdout) as { video: { path: string } };
    const defaultOut = path.join(repo.dir, "artifacts", "branch-explainer.mp4");
    assert.notEqual(report.video.path, defaultOut);
    assert.match(second.stderr, /Existing output kept/);
    // The first output is untouched.
    await stat(defaultOut);
  } finally {
    await repo.cleanup();
  }
});

test("a failed render keeps artifacts and a re-run resumes without regenerating audio", async () => {
  const repo = await featureRepo();
  try {
    const authoredPlan = await writeAuthoredPlan(repo, "resume");
    const failed = await runCli(
      ORCHESTRATOR,
      ["--repo", repo.dir, "--run-id", "resume", "--plan", authoredPlan],
      offlineEnv({ EXPLAIN_BRANCH_TEST_RENDER_FAIL: "1" }),
      repo.dir,
    );
    assert.equal(failed.code, 1, `stderr: ${failed.stderr}`);
    assert.match(failed.stderr, /kept/);
    assert.match(failed.stderr, /npm run explain/);

    const runDir = path.join(repo.dir, "artifacts", "resume");
    const planPath = path.join(runDir, "plan.json");
    await stat(planPath);
    const plan = JSON.parse(await readFile(planPath, "utf8")) as {
      scenes: Array<{ narrationAudioPath?: string }>;
    };
    const firstClip = path.join(repo.dir, plan.scenes[0]!.narrationAudioPath!);
    const before = (await stat(firstClip)).mtimeMs;

    const resumed = await runCli(
      ORCHESTRATOR,
      ["--repo", repo.dir, "--run-id", "resume", "--plan", authoredPlan],
      offlineEnv(),
      repo.dir,
    );
    assert.equal(resumed.code, 0, `stderr: ${resumed.stderr}`);
    assert.match(resumed.stderr, /Narration already generated/);

    // The clip was reused, not regenerated.
    assert.equal((await stat(firstClip)).mtimeMs, before);
    const report = JSON.parse(resumed.stdout) as { video: { path: string } };
    await stat(report.video.path);
  } finally {
    await repo.cleanup();
  }
});
