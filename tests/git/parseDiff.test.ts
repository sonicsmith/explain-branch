import test from "node:test";
import assert from "node:assert/strict";
import { parseUnifiedDiff, toLineRanges } from "../../src/git/parseDiff.ts";

const MODIFIED = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,5 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 console.log(a);
 export {};
@@ -20,3 +21,2 @@
 context1
-context2
 context3
`;

const ADDED = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
`;

const DELETED = `diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 3333333..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-line one
-line two
`;

const RENAMED = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 95%
rename from src/old-name.ts
rename to src/new-name.ts
index 1111111..2222222 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,3 +1,3 @@
 line1
-old line
+new line
 line3
`;

const BINARY = `diff --git a/assets/logo.png b/assets/logo.png
new file mode 100644
index 0000000..4444444
Binary files /dev/null and b/assets/logo.png differ
`;

test("returns nothing for empty input", () => {
  assert.deepEqual(parseUnifiedDiff(""), []);
});

test("parses a modified file with multiple hunks and line ranges", () => {
  const files = parseUnifiedDiff(MODIFIED);

  assert.equal(files.length, 1);
  const [file] = files;
  assert.ok(file);
  assert.equal(file.path, "src/app.ts");
  assert.equal(file.changeType, "modified");
  assert.equal(file.isBinary, false);
  assert.equal(file.hunks.length, 2);
  assert.equal(file.addedLineCount, 2);
  assert.equal(file.deletedLineCount, 2);

  const [first, second] = file.hunks;
  assert.ok(first);
  assert.ok(second);
  assert.deepEqual(first.addedLines, [2, 3]);
  assert.deepEqual(first.addedRanges, [{ startLine: 2, endLine: 3 }]);
  assert.deepEqual(first.deletedLines, [2]);
  assert.deepEqual(second.deletedLines, [21]);
  assert.deepEqual(second.addedLines, []);
});

test("parses an added file", () => {
  const [file] = parseUnifiedDiff(ADDED);
  assert.ok(file);
  assert.equal(file.path, "src/new.ts");
  assert.equal(file.changeType, "added");
  assert.equal(file.oldPath, null);
  assert.equal(file.addedLineCount, 2);
  assert.deepEqual(file.hunks[0]?.addedRanges, [{ startLine: 1, endLine: 2 }]);
});

test("parses a deleted file", () => {
  const [file] = parseUnifiedDiff(DELETED);
  assert.ok(file);
  assert.equal(file.path, "src/gone.ts");
  assert.equal(file.changeType, "deleted");
  assert.equal(file.deletedLineCount, 2);
  assert.deepEqual(file.hunks[0]?.deletedRanges, [
    { startLine: 1, endLine: 2 },
  ]);
});

test("parses a renamed file and keeps both paths", () => {
  const [file] = parseUnifiedDiff(RENAMED);
  assert.ok(file);
  assert.equal(file.changeType, "renamed");
  assert.equal(file.path, "src/new-name.ts");
  assert.equal(file.oldPath, "src/old-name.ts");
});

test("detects binary files and records no hunks", () => {
  const [file] = parseUnifiedDiff(BINARY);
  assert.ok(file);
  assert.equal(file.isBinary, true);
  assert.equal(file.hunks.length, 0);
  assert.equal(file.changeType, "added");
});

test("parses multiple files in one diff", () => {
  const files = parseUnifiedDiff(`${ADDED}${DELETED}${RENAMED}`);
  assert.deepEqual(
    files.map((file) => file.path),
    ["src/new.ts", "src/gone.ts", "src/new-name.ts"],
  );
});

test("collapses line numbers into ranges", () => {
  assert.deepEqual(toLineRanges([]), []);
  assert.deepEqual(toLineRanges([1, 2, 3, 7, 9, 10]), [
    { startLine: 1, endLine: 3 },
    { startLine: 7, endLine: 7 },
    { startLine: 9, endLine: 10 },
  ]);
});
