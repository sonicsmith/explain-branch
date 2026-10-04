/**
 * Minimal WAV reader/writer (Phase 4 §2–§3). Duration is read straight from the RIFF
 * header — no dependency, no decode — which is why `wav` is the preferred clip format.
 */
import { NarrationError } from "./provider.ts";

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Number of bytes in the `data` chunk (clamped to what is actually present). */
  dataBytes: number;
  durationMs: number;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return value;
}

/**
 * Parses a RIFF/WAVE header and returns its format plus duration in integer milliseconds.
 * Tolerates extra chunks and odd-sized chunks (which carry a padding byte). Throws
 * {@link NarrationError} when the bytes are not a parseable PCM WAV.
 */
export function readWavInfo(bytes: Uint8Array): WavInfo {
  if (
    bytes.length < 12 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WAVE"
  ) {
    throw new NarrationError(
      "Not a RIFF/WAVE file; cannot read the audio duration.",
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let sampleRate: number | null = null;
  let channels: number | null = null;
  let bitsPerSample: number | null = null;
  let dataBytes: number | null = null;
  let byteRate: number | null = null;

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = ascii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const available = Math.max(0, bytes.length - dataStart);

    if (
      chunkId === "fmt " &&
      chunkSize >= 16 &&
      dataStart + 16 <= bytes.length
    ) {
      channels = view.getUint16(dataStart + 2, true);
      sampleRate = view.getUint32(dataStart + 4, true);
      byteRate = view.getUint32(dataStart + 8, true);
      bitsPerSample = view.getUint16(dataStart + 14, true);
    } else if (chunkId === "data") {
      dataBytes = Math.min(chunkSize, available);
    }

    // Chunks are word-aligned: an odd size is followed by a single padding byte.
    offset = dataStart + chunkSize + (chunkSize % 2);
  }

  if (
    sampleRate === null ||
    channels === null ||
    bitsPerSample === null ||
    dataBytes === null
  ) {
    throw new NarrationError(
      "WAV file is missing its fmt or data chunk; cannot read the audio duration.",
    );
  }

  const bytesPerSecond =
    byteRate !== null && byteRate > 0
      ? byteRate
      : sampleRate * channels * (bitsPerSample / 8);
  if (bytesPerSecond <= 0) {
    throw new NarrationError("WAV file reports an invalid byte rate.");
  }

  return {
    sampleRate,
    channels,
    bitsPerSample,
    dataBytes,
    durationMs: Math.round((dataBytes / bytesPerSecond) * 1000),
  };
}

export function readWavDurationMs(bytes: Uint8Array): number {
  return readWavInfo(bytes).durationMs;
}

/**
 * Builds a valid mono 16-bit PCM WAV of silence. Used by the fake provider and tests so the
 * pipeline can run end to end without the network.
 */
export function createSilenceWav(
  durationMs: number,
  options: { sampleRate?: number; channels?: number } = {},
): Uint8Array {
  const sampleRate = options.sampleRate ?? 24000;
  const channels = options.channels ?? 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const sampleFrames = Math.max(
    1,
    Math.round((sampleRate * Math.max(0, durationMs)) / 1000),
  );
  const dataBytes = sampleFrames * channels * bytesPerSample;
  const headerBytes = 44;

  const out = new Uint8Array(headerBytes + dataBytes);
  const view = new DataView(out.buffer);

  const writeAscii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      out[offset + index] = text.charCodeAt(index);
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  // The data chunk is left as zeros (silence).

  return out;
}
