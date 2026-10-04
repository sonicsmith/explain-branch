import test from "node:test";
import assert from "node:assert/strict";
import { resolveAudioSrc } from "../../src/render/audioSource.ts";

test("resolves a clip through staticFile() by default", () => {
  const src = resolveAudioSrc("artifacts/run/audio/scene-1.wav");
  assert.ok(src !== null);
  assert.ok(src.startsWith("/"));
  assert.match(src, /artifacts\/run\/audio\/scene-1\.wav$/);
});

test("strips leading slashes before resolving", () => {
  const src = resolveAudioSrc("/artifacts/run/audio/scene-1.wav");
  assert.match(src ?? "", /artifacts\/run\/audio\/scene-1\.wav$/);
});

test("uses an explicit audio base URL when provided", () => {
  const src = resolveAudioSrc("artifacts/run/audio/scene-1.wav", {
    audioBaseUrl: "https://cdn.example.com/branch/",
  });
  assert.equal(
    src,
    "https://cdn.example.com/branch/artifacts/run/audio/scene-1.wav",
  );
});

test("returns null for an empty path", () => {
  assert.equal(resolveAudioSrc(""), null);
  assert.equal(resolveAudioSrc("   "), null);
  assert.equal(resolveAudioSrc("/"), null);
});
