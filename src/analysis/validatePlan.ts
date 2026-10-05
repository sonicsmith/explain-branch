import {
  PLAN_SCHEMA_VERSION,
  SCENE_CHANGE_TYPES,
  SCENE_VISUALS,
  type ExplainerPlan,
  type ExplainerScene,
  type SceneChange,
  type SceneStep,
} from "../planning/types.ts";
import { relativePathError } from "../planning/paths.ts";
import type { SourceSnapshot } from "./sourceSnapshot.ts";

export interface ValidationIssue {
  /** Dotted location of the problem, e.g. `scenes[1].sourceLocations[0].endLine`. */
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
}

export interface ValidatePlanOptions {
  /** Captured source used to verify that referenced paths and line ranges exist. */
  snapshot: SourceSnapshot;
  /** Require per-scene narration audio metadata (used from Phase 4 onward). */
  requireNarrationAudio?: boolean;
  /**
   * Require non-empty narration text. Defaults to `true`; the scaffold produced for the
   * host agent sets this to `false` because the agent authors the narration afterwards.
   */
  requireNarration?: boolean;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isLineRange(start: unknown, end: unknown): boolean {
  return isPositiveInteger(start) && isPositiveInteger(end) && end >= start;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isSceneChangeType(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (SCENE_CHANGE_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Validates a scene plan against the schema and a captured source snapshot. Returns every
 * problem found rather than throwing, so callers can report all issues at once.
 */
export function validatePlan(
  plan: ExplainerPlan,
  options: ValidatePlanOptions,
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const add = (path: string, message: string): void => {
    errors.push({ path, message });
  };

  if (plan === null || typeof plan !== "object") {
    return {
      valid: false,
      errors: [{ path: "plan", message: "plan must be an object" }],
    };
  }

  if (plan.schemaVersion !== PLAN_SCHEMA_VERSION) {
    add(
      "schemaVersion",
      `unsupported schema version ${String(plan.schemaVersion)}; expected ${PLAN_SCHEMA_VERSION}`,
    );
  }

  if (!isNonEmptyString(plan.title))
    add("title", "title must be a non-empty string");
  if (!isNonEmptyString(plan.repositoryName)) {
    add("repositoryName", "repositoryName must be a non-empty string");
  }
  if (!isNonEmptyString(plan.branchName)) {
    add("branchName", "branchName must be a non-empty string");
  }
  if (!isNonEmptyString(plan.baseRef))
    add("baseRef", "baseRef must be a non-empty string");
  if (
    !isNonEmptyString(plan.generatedAt) ||
    Number.isNaN(Date.parse(plan.generatedAt))
  ) {
    add("generatedAt", "generatedAt must be an ISO-8601 timestamp");
  }

  if (!Array.isArray(plan.scenes) || plan.scenes.length === 0) {
    add("scenes", "plan must contain at least one scene");
  } else {
    const seenIds = new Set<string>();
    plan.scenes.forEach((scene, index) => {
      validateScene(scene, `scenes[${index}]`, options, seenIds, add);
    });
  }

  if (!Array.isArray(plan.omissions)) {
    add("omissions", "omissions must be an array");
  } else {
    plan.omissions.forEach((omission, index) => {
      if (!isNonEmptyString(omission?.item)) {
        add(
          `omissions[${index}].item`,
          "omission item must be a non-empty string",
        );
      }
      if (!isNonEmptyString(omission?.reason)) {
        add(
          `omissions[${index}].reason`,
          "omission reason must be a non-empty string",
        );
      }
    });
  }

  if (!Array.isArray(plan.caveats)) {
    add("caveats", "caveats must be an array");
  }

  return { valid: errors.length === 0, errors };
}

function validateScene(
  scene: ExplainerScene,
  path: string,
  options: ValidatePlanOptions,
  seenIds: Set<string>,
  add: (path: string, message: string) => void,
): void {
  if (scene === null || typeof scene !== "object") {
    add(path, "scene must be an object");
    return;
  }

  if (!isNonEmptyString(scene.id)) {
    add(`${path}.id`, "scene id must be a non-empty string");
  } else if (seenIds.has(scene.id)) {
    add(`${path}.id`, `duplicate scene id "${scene.id}"`);
  } else {
    seenIds.add(scene.id);
  }

  if (!isNonEmptyString(scene.title))
    add(`${path}.title`, "title must be a non-empty string");
  if (!isNonEmptyString(scene.purpose)) {
    add(`${path}.purpose`, "purpose must be a non-empty string");
  }
  if (
    options.requireNarration !== false &&
    !isNonEmptyString(scene.narrationText)
  ) {
    add(`${path}.narrationText`, "narrationText must be a non-empty string");
  }
  if (!SCENE_VISUALS.includes(scene.visual)) {
    add(`${path}.visual`, `visual must be one of ${SCENE_VISUALS.join(", ")}`);
  }

  const locations = Array.isArray(scene.sourceLocations)
    ? scene.sourceLocations
    : [];
  if (!Array.isArray(scene.sourceLocations)) {
    add(`${path}.sourceLocations`, "sourceLocations must be an array");
  }

  locations.forEach((location, index) => {
    const locationPath = `${path}.sourceLocations[${index}]`;
    const pathError = relativePathError(location.file ?? "");
    if (pathError !== null) {
      add(`${locationPath}.file`, pathError);
      return;
    }

    if (!isLineRange(location.startLine, location.endLine)) {
      add(
        `${locationPath}`,
        "startLine/endLine must be positive integers with endLine >= startLine",
      );
      return;
    }

    if (!options.snapshot.has(location.file)) {
      add(
        `${locationPath}.file`,
        `"${location.file}" is not present in the captured source`,
      );
      return;
    }

    const lineCount = options.snapshot.lineCount(location.file);
    if (location.endLine > lineCount) {
      add(
        `${locationPath}.endLine`,
        `endLine ${location.endLine} exceeds the ${lineCount} line(s) in "${location.file}"`,
      );
    }
  });

  if (!Array.isArray(scene.highlights)) {
    add(`${path}.highlights`, "highlights must be an array");
  } else {
    scene.highlights.forEach((highlight, index) => {
      const highlightPath = `${path}.highlights[${index}]`;
      if (!isLineRange(highlight.startLine, highlight.endLine)) {
        add(
          highlightPath,
          "startLine/endLine must be positive integers with endLine >= startLine",
        );
        return;
      }

      const contained = locations.some(
        (location) =>
          location.startLine <= highlight.startLine &&
          highlight.endLine <= location.endLine,
      );
      if (!contained) {
        add(
          highlightPath,
          "highlight must fall within one of the scene's sourceLocations",
        );
      }
    });
  }

  if (scene.steps !== undefined) {
    if (!Array.isArray(scene.steps)) {
      add(`${path}.steps`, "steps must be an array");
    } else {
      const requireNarration = options.requireNarration !== false;
      scene.steps.forEach((step, index) => {
        const stepPath = `${path}.steps[${index}]`;
        const raw = (step ?? {}) as Partial<SceneStep>;
        if (requireNarration && !isNonEmptyString(raw.narration)) {
          add(
            `${stepPath}.narration`,
            "step narration must be a non-empty string",
          );
        }
        const stepPathError = relativePathError(raw.file ?? "");
        if (stepPathError !== null) {
          add(`${stepPath}.file`, stepPathError);
          return;
        }
        if (!isLineRange(raw.startLine, raw.endLine)) {
          add(
            stepPath,
            "startLine/endLine must be positive integers with endLine >= startLine",
          );
          return;
        }
        const location = locations.find(
          (candidate) => candidate.file === raw.file,
        );
        if (location === undefined) {
          add(
            `${stepPath}.file`,
            "step file must be one of the scene's sourceLocations",
          );
          return;
        }
        if (
          raw.startLine < location.startLine ||
          raw.endLine > location.endLine
        ) {
          add(
            stepPath,
            `step range must fall within the sourceLocation for "${raw.file}"`,
          );
        }
      });
    }
  }

  if (scene.changes !== undefined) {
    if (!Array.isArray(scene.changes)) {
      add(`${path}.changes`, "changes must be an array");
    } else {
      (scene.changes as readonly unknown[]).forEach((raw, index) => {
        const changePath = `${path}.changes[${index}]`;
        const change = (raw ?? {}) as Partial<SceneChange>;

        const changePathError = relativePathError(change.path ?? "");
        if (changePathError !== null) {
          add(`${changePath}.path`, changePathError);
        }
        if (!isSceneChangeType(change.changeType)) {
          add(
            `${changePath}.changeType`,
            `changeType must be one of ${SCENE_CHANGE_TYPES.join(", ")}`,
          );
        }
        if (!isNonEmptyString(change.language)) {
          add(`${changePath}.language`, "language must be a non-empty string");
        }
        if (
          !isNonNegativeInteger(change.addedLines) ||
          !isNonNegativeInteger(change.deletedLines)
        ) {
          add(
            changePath,
            "addedLines/deletedLines must be non-negative integers",
          );
        }
      });
    }
  }

  if (scene.diagramSpec !== undefined) {
    validateDiagram(scene.diagramSpec, `${path}.diagramSpec`, add);
  }

  if (options.requireNarrationAudio === true) {
    if (!isNonEmptyString(scene.narrationAudioPath)) {
      add(
        `${path}.narrationAudioPath`,
        "narration audio is required for every scene",
      );
    }
    if (
      typeof scene.narrationDurationMs !== "number" ||
      !(scene.narrationDurationMs > 0)
    ) {
      add(
        `${path}.narrationDurationMs`,
        "narrationDurationMs must be a positive number",
      );
    }
  }
}

function validateDiagram(
  diagram: NonNullable<ExplainerScene["diagramSpec"]>,
  path: string,
  add: (path: string, message: string) => void,
): void {
  if (!isNonEmptyString(diagram.description)) {
    add(
      `${path}.description`,
      "diagram description must be a non-empty string",
    );
  }

  if (!Array.isArray(diagram.nodes) || diagram.nodes.length === 0) {
    add(`${path}.nodes`, "diagram must contain at least one node");
    return;
  }

  const nodeIds = new Set<string>();
  diagram.nodes.forEach((node, index) => {
    if (!isNonEmptyString(node?.id)) {
      add(`${path}.nodes[${index}].id`, "node id must be a non-empty string");
      return;
    }
    if (nodeIds.has(node.id)) {
      add(`${path}.nodes[${index}].id`, `duplicate node id "${node.id}"`);
    }
    nodeIds.add(node.id);
    if (!isNonEmptyString(node.label)) {
      add(
        `${path}.nodes[${index}].label`,
        "node label must be a non-empty string",
      );
    }
  });

  if (!Array.isArray(diagram.edges)) {
    add(`${path}.edges`, "diagram edges must be an array");
    return;
  }

  diagram.edges.forEach((edge, index) => {
    if (!nodeIds.has(edge?.from)) {
      add(
        `${path}.edges[${index}].from`,
        `edge references unknown node "${String(edge?.from)}"`,
      );
    }
    if (!nodeIds.has(edge?.to)) {
      add(
        `${path}.edges[${index}].to`,
        `edge references unknown node "${String(edge?.to)}"`,
      );
    }
  });
}
