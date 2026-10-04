/**
 * Run report and output artifacts (Phase 5 §5).
 *
 * Every successful run writes a machine-readable report (`<run-dir>/report.json`) recording
 * what was analysed, the narration clips, the rendered video, omissions/caveats, redactions,
 * and the cost estimate. The narration script is saved alongside it (`<run-dir>/narration.txt`)
 * so the plan JSON, narration script, and render input travel with the video (§14.9).
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChangeInventory } from "../analysis/buildChangeInventory.ts";
import type { CostEstimate } from "../narration/estimate.ts";
import { estimateSpeechCost } from "../narration/estimate.ts";
import { countSpeechCharacters } from "../narration/limits.ts";
import type { RedactPlanResult } from "../narration/redact.ts";
import type { NarrationConfig } from "../narration/types.ts";
import type { ExplainerPlan } from "../planning/types.ts";
import {
  buildRenderTimeline,
  resolveRenderOptions,
  type RenderInput,
} from "../render/RenderInput.ts";

/** Bumped whenever the report shape changes in a way consumers must handle. */
export const REPORT_SCHEMA_VERSION = 1;

export interface ReportBase {
  ref: string;
  source: string;
  mergeBase: string | null;
}

export interface ReportClip {
  sceneId: string;
  title: string;
  audioPath: string | null;
  durationMs: number | null;
}

export interface ReportArtifacts {
  runDir: string;
  /** The validated (narrated) plan JSON. */
  planJson: string;
  /** The narration script. */
  narrationScript: string;
  /** The render input actually passed to the renderer. */
  renderInput: string;
}

export interface RunReport {
  schemaVersion: number;
  generatedAt: string;
  branch: string | null;
  headCommit: string | null;
  base: ReportBase | null;
  workingTree: {
    isDirty: boolean;
    included: boolean;
    changedFiles: number;
  };
  scenes: number;
  narration: {
    provider: string;
    model: string;
    voice: string;
    format: string;
  };
  clips: ReportClip[];
  /** Sum of the measured narration clip durations. */
  narrationDurationMs: number;
  /** Rendered video length derived from the narration-driven timeline. */
  videoDurationMs: number;
  video: { path: string; bytes: number } | null;
  omissions: Array<{ item: string; reason: string }>;
  caveats: string[];
  redactions: {
    total: number;
    details: Array<{ sceneId: string; kinds: string }>;
  };
  cost: CostEstimate;
  artifacts: ReportArtifacts;
}

export interface BuildRunReportInput {
  inventory: ChangeInventory;
  plan: ExplainerPlan;
  /** Whether uncommitted working-tree changes were included in the analysis. */
  workingTreeIncluded: boolean;
  config: NarrationConfig;
  /** Measured cost estimate; recomputed from the plan when omitted (e.g. on a resume). */
  cost?: CostEstimate;
  /** Redactions applied this run; absent on a resume (the plan was redacted already). */
  redaction?: RedactPlanResult;
  video?: { path: string; bytes: number } | null;
  artifacts: ReportArtifacts;
  generatedAt?: string;
}

/** Total narration characters in a plan (the TTS billing unit). */
function planCharacters(plan: ExplainerPlan): number {
  return plan.scenes.reduce(
    (total, scene) => total + countSpeechCharacters(scene.narrationText),
    0,
  );
}

export function buildRunReport(input: BuildRunReportInput): RunReport {
  const { inventory, plan, config } = input;

  const clips: ReportClip[] = plan.scenes.map((scene) => ({
    sceneId: scene.id,
    title: scene.title,
    audioPath: scene.narrationAudioPath ?? null,
    durationMs:
      typeof scene.narrationDurationMs === "number"
        ? scene.narrationDurationMs
        : null,
  }));

  const narrationDurationMs = clips.reduce(
    (total, clip) => total + (clip.durationMs ?? 0),
    0,
  );

  const fps = resolveRenderOptions({}).fps;
  const timeline = buildRenderTimeline({
    plan,
    sources: {},
    options: {},
  } satisfies RenderInput);
  const videoDurationMs = Math.round((timeline.durationInFrames / fps) * 1000);

  const cost = input.cost ??
    estimateSpeechCost(config.model, planCharacters(plan)) ?? {
      usd: 0,
      basis: "unknown model pricing",
      complete: false,
    };

  const redaction = input.redaction;

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    branch: inventory.currentBranch,
    headCommit: inventory.headCommit,
    base:
      inventory.base === null
        ? null
        : {
            ref: inventory.base.ref,
            source: inventory.base.source,
            mergeBase: inventory.base.mergeBase,
          },
    workingTree: {
      isDirty: inventory.workingTree.isDirty,
      included: input.workingTreeIncluded,
      changedFiles: inventory.workingTree.changedPaths.length,
    },
    scenes: plan.scenes.length,
    narration: {
      provider: config.provider,
      model: config.model,
      voice: config.voice,
      format: config.format,
    },
    clips,
    narrationDurationMs,
    videoDurationMs,
    video: input.video ?? null,
    omissions: plan.omissions.map((entry) => ({
      item: entry.item,
      reason: entry.reason,
    })),
    caveats: [...plan.caveats],
    redactions:
      redaction === undefined
        ? { total: 0, details: [] }
        : {
            total: redaction.totalRedactions,
            details: redaction.reports.map((report) => ({
              sceneId: report.sceneId,
              kinds: report.redactions
                .map((entry) => `${entry.kind} x${entry.count}`)
                .join(", "),
            })),
          },
    cost,
    artifacts: input.artifacts,
  };
}

/** Writes `<run-dir>/report.json` and returns its path. */
export async function writeRunReport(
  runDir: string,
  report: RunReport,
): Promise<string> {
  const reportPath = path.join(runDir, "report.json");
  await mkdir(runDir, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return reportPath;
}

/** Builds the human-readable narration script from a plan's scene narration. */
export function formatNarrationScript(plan: ExplainerPlan): string {
  const lines: string[] = [];
  lines.push(`# Narration script — ${plan.title}`);
  lines.push("");
  lines.push(`Branch: ${plan.branchName}    Base: ${plan.baseRef}`);
  lines.push("");
  plan.scenes.forEach((scene, index) => {
    lines.push(`## ${index + 1}. ${scene.title}`);
    lines.push("");
    lines.push(scene.narrationText.trim());
    lines.push("");
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Writes `<run-dir>/narration.txt` and returns its path. */
export async function writeNarrationScript(
  runDir: string,
  plan: ExplainerPlan,
): Promise<string> {
  const scriptPath = path.join(runDir, "narration.txt");
  await mkdir(runDir, { recursive: true });
  await writeFile(scriptPath, formatNarrationScript(plan), "utf8");
  return scriptPath;
}

/**
 * Verifies the rendered MP4 exists and is non-empty. Returns its size in bytes, or `null`
 * when the file is missing or zero-byte — callers treat that as a render failure.
 */
export async function verifyRenderedVideo(
  outPath: string,
): Promise<number | null> {
  try {
    const info = await stat(outPath);
    return info.isFile() && info.size > 0 ? info.size : null;
  } catch {
    return null;
  }
}

/** Human-readable summary written to stderr (the JSON report goes to stdout). */
export function formatReportSummary(report: RunReport): string {
  const lines: string[] = [];
  const base =
    report.base === null
      ? "(unresolved)"
      : `${report.base.ref} (${report.base.source})`;
  lines.push(`Branch:    ${report.branch ?? "(detached HEAD)"}`);
  lines.push(`Base:      ${base}`);
  lines.push(`Scenes:    ${report.scenes}`);
  lines.push(
    `Duration:  ${(report.videoDurationMs / 1000).toFixed(1)}s video` +
      ` (${(report.narrationDurationMs / 1000).toFixed(1)}s narration)`,
  );
  lines.push(
    `Narration: ${report.narration.voice} (${report.narration.model}, ${report.narration.format})`,
  );
  lines.push(
    `Cost:      $${report.cost.usd.toFixed(4)} (${report.cost.basis}${report.cost.complete ? "" : "; incomplete"})`,
  );
  lines.push(
    `Video:     ${report.video?.path ?? "(not rendered)"} (${report.video?.bytes ?? 0} bytes)`,
  );
  if (report.redactions.total > 0) {
    lines.push(`Redactions: ${report.redactions.total} (see report.json)`);
  }
  if (report.omissions.length > 0) {
    lines.push(`Omitted:   ${report.omissions.length} item(s) not explained`);
    for (const omission of report.omissions) {
      lines.push(`  - ${omission.item}: ${omission.reason}`);
    }
  }
  if (report.caveats.length > 0) {
    lines.push("Caveats:");
    for (const caveat of report.caveats) lines.push(`  - ${caveat}`);
  }
  return lines.join("\n");
}
