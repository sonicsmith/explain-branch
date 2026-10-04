/**
 * Offline test seams for the orchestrator (Phase 5 §7).
 *
 * These let the end-to-end test exercise the real orchestration flow — run directory,
 * resume, report, exit codes — without the network or Chrome. They are **inert unless the
 * `EXPLAIN_BRANCH_TEST_*` environment variables are set**, so normal runs are unaffected.
 *
 * - `EXPLAIN_BRANCH_TEST_FAKE_TTS=1`     use the offline {@link FakeSpeechProvider}
 *                                        (no credential pre-flight, no API calls)
 * - `EXPLAIN_BRANCH_TEST_SKIP_RENDER=1`  replace Remotion with a placeholder runner that
 *                                        writes a fake MP4 and exits 0
 * - `EXPLAIN_BRANCH_TEST_RENDER_FAIL=1`  make that placeholder runner exit non-zero
 *                                        (to exercise the render-failure/resume path)
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { FakeSpeechProvider } from "../narration/fakeSpeechProvider.ts";
import type { SpeechProvider } from "../narration/provider.ts";

export const FAKE_TTS_ENV = "EXPLAIN_BRANCH_TEST_FAKE_TTS";
export const SKIP_RENDER_ENV = "EXPLAIN_BRANCH_TEST_SKIP_RENDER";
export const RENDER_FAIL_ENV = "EXPLAIN_BRANCH_TEST_RENDER_FAIL";

export type RenderRunner = (
  args: readonly string[],
  cwd: string,
) => Promise<number>;

export function fakeTtsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[FAKE_TTS_ENV] === "1";
}

export function skipRenderEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[SKIP_RENDER_ENV] === "1";
}

/** A fresh offline provider (deterministic silent WAV clips). */
export function createPlaceholderSpeechProvider(): SpeechProvider {
  return new FakeSpeechProvider();
}

/**
 * Stand-in for the Remotion renderer: writes a small placeholder file where the renderer
 * would (so the success path's existence/size check passes) and returns 0 — or returns 1
 * when {@link RENDER_FAIL_ENV} is set, to exercise the recoverable render-failure path.
 */
export function createPlaceholderRenderRunner(): RenderRunner {
  return async (args) => {
    if (process.env[RENDER_FAIL_ENV] === "1") return 1;

    const outPath = args[3];
    if (typeof outPath !== "string") return 1;
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, Buffer.from("placeholder-mp4"));
    return 0;
  };
}
