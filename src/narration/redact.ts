/**
 * Pre-flight secret redaction (Phase 4 §6).
 *
 * Narration text is derived from repository content and is transmitted to the configured TTS
 * provider, so secret-looking values are replaced **before** they can become narration. The
 * redaction is conservative: it favours over-redaction over leaking a credential, and it
 * reports what it filtered so the behaviour is never silent.
 *
 * This is a safety net, not a guarantee — repository content shown on screen (code frames) is
 * not rewritten, so users must still avoid narrating secrets.
 */
import type { ExplainerPlan, ExplainerScene } from "../planning/types.ts";

export interface Redaction {
  /** Category of secret that matched, e.g. `openai-key`. */
  kind: string;
  count: number;
}

export interface RedactResult {
  text: string;
  redactions: Redaction[];
}

interface Rule {
  kind: string;
  pattern: RegExp;
}

/**
 * Ordered rules. Earlier rules win, so specific credentials are replaced before the generic
 * high-entropy rule can match part of them.
 */
const RULES: readonly Rule[] = [
  { kind: "openai-key", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  {
    kind: "github-token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  },
  { kind: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  {
    kind: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  },
  {
    kind: "private-key",
    pattern:
      /-----BEGIN[^\n]*PRIVATE KEY-----[\s\S]*?-----END[^\n]*PRIVATE KEY-----/g,
  },
  {
    kind: "url-credentials",
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/gi,
  },
  {
    kind: "env-assignment",
    pattern:
      /\b(?:[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH)[A-Z0-9_]*)\s*=\s*["']?[^\s"']{6,}["']?/g,
  },
  {
    // Long high-entropy runs (base64/hex-ish). Requiring a digit avoids most prose and code
    // identifiers while still catching opaque tokens.
    kind: "high-entropy",
    pattern: /(?=[A-Za-z0-9+/=_-]*[0-9])[A-Za-z0-9][A-Za-z0-9+/=_-]{31,}/g,
  },
];

/** Replaces secret-looking substrings with `[REDACTED:<kind>]` markers. */
export function redactSecrets(text: string): RedactResult {
  let output = text;
  const counts = new Map<string, number>();

  for (const rule of RULES) {
    output = output.replace(rule.pattern, () => {
      counts.set(rule.kind, (counts.get(rule.kind) ?? 0) + 1);
      return `[REDACTED:${rule.kind}]`;
    });
  }

  const redactions = [...counts].map(([kind, count]) => ({ kind, count }));
  return { text: output, redactions };
}

export interface SceneRedactionReport {
  sceneId: string;
  redactions: Redaction[];
}

export interface RedactPlanResult {
  /** The plan with redacted narration text (the same object when nothing matched). */
  plan: ExplainerPlan;
  reports: SceneRedactionReport[];
  totalRedactions: number;
}

/**
 * Redacts secret-looking values from every scene's narration text. The returned plan is used
 * for narration and rendering, so secrets never reach the provider, the written plan, the
 * captions, or the video.
 */
export function redactPlanNarration(plan: ExplainerPlan): RedactPlanResult {
  const reports: SceneRedactionReport[] = [];
  let totalRedactions = 0;

  const scenes = plan.scenes.map((scene) => {
    const { text, redactions } = redactSecrets(scene.narrationText);
    // Step narrations are shown as captions, so they must be scrubbed too.
    const stepResults = (scene.steps ?? []).map((step) =>
      redactSecrets(step.narration ?? ""),
    );
    const allRedactions = [
      ...redactions,
      ...stepResults.flatMap((result) => result.redactions),
    ];
    if (allRedactions.length === 0) return scene;

    reports.push({ sceneId: scene.id, redactions: allRedactions });
    totalRedactions += allRedactions.reduce(
      (sum, entry) => sum + entry.count,
      0,
    );

    const next: ExplainerScene = { ...scene, narrationText: text };
    if (scene.steps !== undefined) {
      next.steps = scene.steps.map((step, index) => ({
        ...step,
        narration: stepResults[index]?.text ?? step.narration,
      }));
    }
    return next;
  });

  if (reports.length === 0) {
    return { plan, reports, totalRedactions: 0 };
  }
  return { plan: { ...plan, scenes }, reports, totalRedactions };
}
