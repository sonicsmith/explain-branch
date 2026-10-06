# Plan, report, and artifact schemas

Source of truth (keep in sync): `src/planning/types.ts` (`PLAN_SCHEMA_VERSION`) and
`src/pipeline/report.ts` (`REPORT_SCHEMA_VERSION`).

## Scene plan (`plan.json`)

`PLAN_SCHEMA_VERSION = 3`. **Authored by the host coding agent** (see
`skills/explain-branch/SKILL.md`): the script writes only a narration-blank _scaffold_
(`artifacts/branch-explain/plan.scaffold.json`) and then, once the agent supplies a plan,
rewrites it with audio metadata via the narration stage.

```ts
interface ExplainerPlan {
  schemaVersion: number; // 3
  title: string;
  repositoryName: string;
  branchName: string;
  baseRef: string;
  generatedAt: string; // ISO 8601
  scenes: ExplainerScene[];
  omissions: Array<{ item: string; reason: string }>;
  caveats: string[];
}

interface SceneStep {
  narration: string; // plain-English explanation of the highlighted lines
  file: string; // repository-relative; must be one of the scene's sourceLocations
  startLine: number; // 1-based, inclusive (a few lines)
  endLine: number;
}

interface ExplainerScene {
  id: string; // unique
  title: string;
  purpose: string;
  narrationText: string; // full script (the TTS input); should equal the steps joined
  visual: "code-walkthrough" | "diff" | "architecture" | "summary";
  sourceLocations: Array<{ file: string; startLine: number; endLine: number }>;
  highlights: Array<{ startLine: number; endLine: number; label?: string }>;
  steps?: SceneStep[]; // ordered walkthrough; the renderer advances through them
  changes?: SceneChange[]; // path/changeType/language/added/deleted/isBinary/isGenerated
  diagramSpec?: {
    description: string;
    nodes: DiagramNode[];
    edges: DiagramEdge[];
  };
  narrationAudioPath?: string; // repository-relative POSIX (set by narration)
  narrationDurationMs?: number; // integer ms (set by narration)
}
```

A `code-walkthrough` scene with `steps` plays them in order: the highlighted range advances as
the narration plays, a few lines at a time. The renderer divides the scene's single audio clip
across the steps in proportion to each step's narration length, so the highlight moves in time
with the voice. Captions are off by default (the narration carries the explanation); when
enabled, they reuse the same windows so highlight and caption always agree.

**Authoring a step.** Read the code at the range (and enough context to understand it), then
write one to three sentences explaining what those lines do. Assume the viewer may not know the
language. Set the scene's `narrationText` to the step narrations joined with a space. Do not
list files or counts; explain behaviour.

**Validation** (`validatePlan`, `src/analysis/validatePlan.ts`): paths must be
repository-relative (no absolute paths, no `..`); line ranges must fall within the captured
source snapshot; highlights must sit inside a `sourceLocation`; step files must be one of the
scene's `sourceLocations` and each step range must sit inside that location; scene ids must be
unique; diagram edges must reference real nodes. The scaffold is validated with
`requireNarration: false` (blank narration allowed); a plan handed to the renderer requires
non-empty `narrationText` and step narration. With `requireNarrationAudio: true` every scene
must have `narrationAudioPath` + a positive `narrationDurationMs`.

## Run report (`report.json`)

`REPORT_SCHEMA_VERSION = 1`. Written by `buildRunReport`/`writeRunReport` and printed to
stdout on success.

```ts
interface RunReport {
  schemaVersion: number; // 1
  generatedAt: string;
  branch: string | null;
  headCommit: string | null;
  base: { ref: string; source: string; mergeBase: string | null } | null;
  workingTree: { isDirty: boolean; included: boolean; changedFiles: number };
  scenes: number;
  narration: { provider: string; model: string; voice: string; format: string };
  clips: Array<{
    sceneId: string;
    title: string;
    audioPath: string | null;
    durationMs: number | null;
  }>;
  narrationDurationMs: number;
  videoDurationMs: number;
  video: { path: string; bytes: number } | null;
  omissions: Array<{ item: string; reason: string }>;
  caveats: string[];
  redactions: {
    total: number;
    details: Array<{ sceneId: string; kinds: string }>;
  };
  cost: { usd: number; basis: string; complete: boolean };
  artifacts: {
    runDir: string;
    planJson: string;
    narrationScript: string;
    renderInput: string;
  };
}
```

## Run directory layout

Everything for one run lives under `<repo>/artifacts/<run-id>/` (run id = sanitised branch
name; override with `--run-id`/`--run-dir`):

```
artifacts/<run-id>/
  plan.json            # the plan you authored, rewritten with narration audio metadata
  authored-plan.json   # checkpoint of the authored plan (enables resume without re-authoring)
  narration.txt        # narration script
  render-input.json    # exactly what was passed to the renderer (plan + sources)
  report.json          # the run report above
  audio/<scene>.<fmt>  # one clip per scene (+ a .json cache sidecar each)
```

The MP4 defaults to `artifacts/branch-explainer.mp4` and never silently overwrites an existing
file (a timestamped name is used unless `--overwrite`).

## Privacy

Narration text is derived from repository content and is sent to the configured TTS provider.
Secret-looking values are redacted before transmission (`src/narration/redact.ts`) — including
step captions — and the redactions applied are recorded in the report.
