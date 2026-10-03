import test from "node:test";
import assert from "node:assert/strict";
import { validatePlan } from "../../src/analysis/validatePlan.ts";
import { snapshotFromContents } from "../../src/analysis/sourceSnapshot.ts";
import {
  PLAN_SCHEMA_VERSION,
  type ExplainerPlan,
} from "../../src/planning/types.ts";

const SNAPSHOT = snapshotFromContents({
  "src/app.ts": "line one\nline two\nline three\n",
  "src/other.ts": "alpha\nbeta\n",
});

/** A permissive builder so tests can construct (and deliberately break) plan shapes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validPlan(): any {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    title: "Branch explainer: feature",
    repositoryName: "demo",
    branchName: "feature",
    baseRef: "main",
    generatedAt: "2026-01-01T00:00:00.000Z",
    scenes: [
      {
        id: "scene-1",
        title: "Changes in src",
        purpose: "Show the code that changed.",
        narrationText: "This change updates one file.",
        visual: "code-walkthrough",
        sourceLocations: [{ file: "src/app.ts", startLine: 1, endLine: 3 }],
        highlights: [{ startLine: 2, endLine: 2 }],
      },
      {
        id: "summary",
        title: "Summary",
        purpose: "Summarise the branch.",
        narrationText: "One file changed.",
        visual: "summary",
        sourceLocations: [],
        highlights: [],
      },
    ],
    omissions: [],
    caveats: ["Narration is derived mechanically from the diff."],
  };
}

function run(plan: unknown) {
  return validatePlan(plan as ExplainerPlan, { snapshot: SNAPSHOT });
}

function messages(plan: unknown): string {
  return run(plan)
    .errors.map((issue) => `${issue.path}: ${issue.message}`)
    .join("\n");
}

test("accepts a well-formed plan", () => {
  const result = run(validPlan());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("rejects a missing or mismatched schema version", () => {
  const plan = validPlan();
  plan.schemaVersion = PLAN_SCHEMA_VERSION + 1;
  assert.equal(run(plan).valid, false);
  assert.match(messages(plan), /schemaVersion/);
});

test("rejects a plan with no scenes", () => {
  const plan = validPlan();
  plan.scenes = [];
  assert.equal(run(plan).valid, false);
  assert.match(messages(plan), /at least one scene/);
});

test("rejects duplicate scene ids", () => {
  const plan = validPlan();
  plan.scenes[1].id = "scene-1";
  assert.equal(run(plan).valid, false);
  assert.match(messages(plan), /duplicate scene id/);
});

test("rejects empty narration text", () => {
  const plan = validPlan();
  plan.scenes[0].narrationText = "   ";
  assert.equal(run(plan).valid, false);
  assert.match(messages(plan), /narrationText/);
});

test("rejects an unknown visual type", () => {
  const plan = validPlan();
  plan.scenes[0].visual = "hologram";
  assert.equal(run(plan).valid, false);
  assert.match(messages(plan), /visual must be one of/);
});

test("rejects a source location that is not in the captured snapshot", () => {
  const plan = validPlan();
  plan.scenes[0].sourceLocations = [
    { file: "src/missing.ts", startLine: 1, endLine: 1 },
  ];
  plan.scenes[0].highlights = [];
  assert.equal(run(plan).valid, false);
  assert.match(messages(plan), /not present in the captured source/);
});

test("rejects a line range beyond the end of the file", () => {
  const plan = validPlan();
  plan.scenes[0].sourceLocations = [
    { file: "src/app.ts", startLine: 1, endLine: 99 },
  ];
  plan.scenes[0].highlights = [];
  assert.equal(run(plan).valid, false);
  assert.match(messages(plan), /exceeds the 3 line/);
});

test("rejects an inverted line range", () => {
  const plan = validPlan();
  plan.scenes[0].highlights = [{ startLine: 3, endLine: 1 }];
  assert.equal(run(plan).valid, false);
  assert.match(messages(plan), /endLine >= startLine/);
});

test("rejects absolute and escaping paths", () => {
  const absolute = validPlan();
  absolute.scenes[0].sourceLocations = [
    { file: "/etc/passwd", startLine: 1, endLine: 1 },
  ];
  absolute.scenes[0].highlights = [];
  assert.match(messages(absolute), /repository-relative/);

  const escaping = validPlan();
  escaping.scenes[0].sourceLocations = [
    { file: "../secret.ts", startLine: 1, endLine: 1 },
  ];
  escaping.scenes[0].highlights = [];
  assert.match(messages(escaping), /\.\./);
});

test("rejects a highlight outside the scene's source locations", () => {
  const plan = validPlan();
  plan.scenes[0].highlights = [{ startLine: 4, endLine: 4 }];
  assert.equal(run(plan).valid, false);
  assert.match(
    messages(plan),
    /fall within one of the scene's sourceLocations/,
  );
});

test("rejects malformed diagram edges", () => {
  const plan = validPlan();
  plan.scenes[0].diagramSpec = {
    description: "Flow",
    nodes: [{ id: "a", label: "A" }],
    edges: [{ from: "a", to: "missing" }],
  };
  assert.equal(run(plan).valid, false);
  assert.match(messages(plan), /unknown node/);
});

test("rejects duplicate diagram node ids", () => {
  const plan = validPlan();
  plan.scenes[0].diagramSpec = {
    description: "Flow",
    nodes: [
      { id: "a", label: "A" },
      { id: "a", label: "Again" },
    ],
    edges: [],
  };
  assert.equal(run(plan).valid, false);
  assert.match(messages(plan), /duplicate node id/);
});

test("requires narration audio when asked to", () => {
  const plan = validPlan();
  const result = validatePlan(plan as ExplainerPlan, {
    snapshot: SNAPSHOT,
    requireNarrationAudio: true,
  });
  assert.equal(result.valid, false);
  assert.match(
    result.errors.map((issue) => issue.path).join("\n"),
    /narrationAudioPath/,
  );
});
