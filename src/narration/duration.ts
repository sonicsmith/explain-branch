/**
 * Audio duration measurement (Phase 4 §3).
 *
 * Source of truth for `narrationDurationMs`. The fast path reads the WAV header directly —
 * no dependency, no decode, no process spawn. Other containers fall back to FFprobe, using
 * the copy bundled with Remotion (auto-downloaded into `node_modules/.remotion`), so no
 * system `ffprobe` install is required.
 */
import { NarrationError } from "./provider.ts";
import { isWav, readWavInfo } from "./wav.ts";

/** Runs FFprobe against a file and returns its duration in integer milliseconds. */
export type FFprobeRunner = (filePath: string) => Promise<number>;

export interface MeasureDurationOptions {
  /** Bytes already read from the clip; enables the WAV header fast path. */
  bytes?: Uint8Array;
  /** Injected FFprobe runner (offline tests); defaults to Remotion's bundled FFprobe. */
  ffprobe?: FFprobeRunner;
}

/**
 * Measures a clip's duration in integer milliseconds. Uses the WAV header when the bytes are
 * a RIFF/WAVE file; otherwise defers to FFprobe.
 */
export async function measureAudioDurationMs(
  filePath: string,
  options: MeasureDurationOptions = {},
): Promise<number> {
  if (options.bytes !== undefined && isWav(options.bytes)) {
    return readWavInfo(options.bytes).durationMs;
  }
  const runner = options.ffprobe ?? remotionFFprobe;
  return runner(filePath);
}

/**
 * FFprobe runner backed by Remotion's bundled binary. Loaded dynamically so the WAV fast
 * path (and the offline test suite) never pulls in `@remotion/renderer`.
 */
export const remotionFFprobe: FFprobeRunner = async (filePath) => {
  let stdout: string;
  try {
    const { RenderInternals } = await import("@remotion/renderer");
    ({ stdout } = await RenderInternals.callFf({
      bin: "ffprobe",
      args: [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      indent: false,
      logLevel: "error",
      binariesDirectory: null,
      cancelSignal: undefined,
    }));
  } catch (error) {
    throw new NarrationError(
      `Could not measure the audio duration with FFprobe: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new NarrationError(
      `FFprobe returned an invalid duration for ${filePath}: "${stdout.trim()}".`,
    );
  }
  return Math.round(seconds * 1000);
};
