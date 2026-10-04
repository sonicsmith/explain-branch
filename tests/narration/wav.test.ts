import test from "node:test";
import assert from "node:assert/strict";
import {
  createSilenceWav,
  readWavDurationMs,
  readWavInfo,
} from "../../src/narration/wav.ts";
import { NarrationError } from "../../src/narration/provider.ts";

test("round-trips a generated silence clip", () => {
  const bytes = createSilenceWav(1500);
  const info = readWavInfo(bytes);
  assert.equal(info.durationMs, 1500);
  assert.equal(info.sampleRate, 24000);
  assert.equal(info.channels, 1);
  assert.equal(info.bitsPerSample, 16);
});

test("reads duration regardless of sample rate", () => {
  const bytes = createSilenceWav(250, { sampleRate: 48000 });
  assert.equal(readWavDurationMs(bytes), 250);
});

/** Builds a PCM WAV, optionally with an extra (odd-sized) chunk before `data`. */
function buildWav(options: {
  dataBytes: number;
  sampleRate: number;
  extraChunkSize?: number;
}): Uint8Array {
  const { dataBytes, sampleRate } = options;
  const extra = options.extraChunkSize ?? 0;
  const extraTotal = extra > 0 ? 8 + extra + (extra % 2) : 0;
  const total = 44 + extraTotal + dataBytes;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  const put = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      bytes[offset + index] = text.charCodeAt(index);
    }
  };

  put(0, "RIFF");
  view.setUint32(4, total - 8, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  let offset = 36;
  if (extra > 0) {
    put(offset, "LIST");
    view.setUint32(offset + 4, extra, true);
    offset += 8 + extra + (extra % 2);
  }
  put(offset, "data");
  view.setUint32(offset + 4, dataBytes, true);
  return bytes;
}

test("skips an odd-sized chunk and its padding byte", () => {
  // 48000 bytes at 24000 Hz mono 16-bit = exactly 1 second.
  const bytes = buildWav({
    dataBytes: 48000,
    sampleRate: 24000,
    extraChunkSize: 3,
  });
  assert.equal(readWavDurationMs(bytes), 1000);
});

test("rejects non-WAV bytes", () => {
  assert.throws(
    () => readWavDurationMs(new Uint8Array([1, 2, 3, 4])),
    NarrationError,
  );
  assert.throws(
    () => readWavDurationMs(new Uint8Array(64)),
    /Not a RIFF\/WAVE file/,
  );
});

test("rejects a WAV without a fmt chunk", () => {
  const bytes = buildWav({ dataBytes: 4800, sampleRate: 24000 });
  // Corrupt the fmt chunk id so parsing cannot find it.
  bytes[12] = "X".charCodeAt(0);
  assert.throws(() => readWavInfo(bytes), /missing its fmt or data chunk/);
});
