# Plan, report, and artifact schemas

Source of truth (keep in sync): `src/planning/types.ts` (`PLAN_SCHEMA_VERSION`) and
`src/pipeline/report.ts` (`REPORT_SCHEMA_VERSION`).

## Scene plan (`plan.json`)

`PLAN_SCHEMA_VERSION = 2`. Written by the planner (`src/cli/planBranch.ts`) and rewritten by
the narration stage (`src/cli/narrateBranch.ts`) with audio metadata filled in.

```ts
interface ExplainerPlan {
  schemaVersion: number; // 2
  title: string;
  repositoryName: string;
  branchName: string;
  baseRef: string;
  generatedAt: string; // ISO 8601
  scenes: ExplainerScene[];
  omissions: Array<{ item: string; reason: string }>;
  caveats: string[];
}

interface ExplainerScene {
  id: string; // unique
  title: string;
  purpose: string;
  narrationText: string;
  visual: "code-walkthrough" | "diff" | "architecture" | "summary";
  sourceLocations: Array<{ file: string; startLine: number; endLine: number }>;
  highlights: Array<{ startLine: number; endLine: number; label?: string }>;
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

**Validation** (`validatePlan`, `src/analysis/validatePlan.ts`): paths must be
repository-relative (no absolute paths, no `..`); line ranges must fall within the captured
source snapshot; highlights must sit inside a `sourceLocation`; scene ids must be unique;
diagram edges must reference real nodes. With `requireNarrationAudio: true` every scene must
have `narrationAudioPath` + a positive `narrationDurationMs`.

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
  branch-plan.json     # pre-narration checkpoint (enables resume without re-planning)
  plan.json            # validated, narrated (redacted) plan
  narration.txt        # narration script
  render-input.json    # exactly what was passed to the renderer (plan + sources)
  report.json          # the run report above
  audio/<scene>.<fmt>  # one clip per scene (+ a .json cache sidecar each)
```

The MP4 defaults to `artifacts/branch-explainer.mp4` and never silently overwrites an existing
file (a timestamped name is used unless `--overwrite`).

## Privacy

Narration text is derived from repository content and is sent to the configured TTS provider.
Secret-looking values are redacted before transmission (`src/narration/redact.ts`), and the
redactions applied are recorded in the report.
