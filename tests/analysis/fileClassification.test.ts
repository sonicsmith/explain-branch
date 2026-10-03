import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyGenerated,
  detectLanguage,
} from "../../src/analysis/fileClassification.ts";

test("detects languages from file names", () => {
  assert.equal(detectLanguage("src/app.ts"), "typescript");
  assert.equal(detectLanguage("src/app.tsx"), "typescript");
  assert.equal(detectLanguage("scripts/build.py"), "python");
  assert.equal(detectLanguage("cmd/server/main.go"), "go");
  assert.equal(detectLanguage("Dockerfile"), "dockerfile");
  assert.equal(detectLanguage("Makefile"), "makefile");
  assert.equal(detectLanguage("config.yaml"), "yaml");
  assert.equal(detectLanguage("README.md"), "markdown");
  assert.equal(detectLanguage("data.unknown-ext"), "unknown");
  assert.equal(detectLanguage("LICENSE"), "unknown");
});

test("flags lockfiles as generated", () => {
  const result = classifyGenerated("package-lock.json");
  assert.equal(result.isGenerated, true);
  assert.equal(result.reason, "lockfile");
});

test("flags files inside generated directories", () => {
  assert.equal(classifyGenerated("dist/bundle.js").isGenerated, true);
  assert.equal(
    classifyGenerated("node_modules/left-pad/index.js").isGenerated,
    true,
  );
  assert.equal(
    classifyGenerated("packages/web/coverage/report.html").isGenerated,
    true,
  );
});

test("flags generated file patterns", () => {
  assert.equal(classifyGenerated("public/app.min.js").isGenerated, true);
  assert.equal(classifyGenerated("lib/model.g.dart").isGenerated, true);
  assert.equal(classifyGenerated("proto/service_pb2.py").isGenerated, true);
});

test("treats ordinary source files as non-generated", () => {
  assert.equal(classifyGenerated("src/app.ts").isGenerated, false);
  assert.equal(classifyGenerated("src/app.ts").reason, null);
  assert.equal(classifyGenerated("README.md").isGenerated, false);
});
