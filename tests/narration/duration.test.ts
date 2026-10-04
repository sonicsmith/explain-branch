import test from "node:test";
import assert from "node:assert/strict";
import { measureAudioDurationMs } from "../../src/narration/duration.ts";
import { createSilenceWav } from "../../src/narration/wav.ts";

test("reads WAV durations from the header without FFprobe", async () => {
  const bytes = createSilenceWav(1234);
  let called = false;
  const durationMs = await measureAudioDurationMs("ignored.wav", {
    bytes,
    ffprobe: async () => {
      called = true;
      return 1;
    },
  });
  assert.equal(durationMs, 1234);
  assert.equal(called, false);
});

test("falls back to FFprobe for non-WAV clips", async () => {
  const bytes = new Uint8Array([0x49, 0x44, 0x33]); // "ID3"
  const probed: string[] = [];
  const durationMs = await measureAudioDurationMs("/tmp/clip.mp3", {
    bytes,
    ffprobe: async (filePath) => {
      probed.push(filePath);
      return 2500;
    },
  });
  assert.equal(durationMs, 2500);
  assert.deepEqual(probed, ["/tmp/clip.mp3"]);
});

test("propagates FFprobe failures", async () => {
  await assert.rejects(
    measureAudioDurationMs("/tmp/clip.mp3", {
      bytes: new Uint8Array([1, 2, 3]),
      ffprobe: async () => {
        throw new Error("no ffprobe available");
      },
    }),
    /no ffprobe available/,
  );
});

test("uses FFprobe when no bytes are supplied", async () => {
  const durationMs = await measureAudioDurationMs("/tmp/clip.wav", {
    ffprobe: async () => 500,
  });
  assert.equal(durationMs, 500);
});
