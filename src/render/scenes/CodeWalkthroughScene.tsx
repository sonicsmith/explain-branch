import { useCurrentFrame } from "remotion";
import type { ExplainerScene, SourceLocation } from "../../planning/types.ts";
import {
  CodeFrame,
  type CodeHighlightRange,
} from "../components/CodeFrame.tsx";
import { MessageCard } from "../components/MessageCard.tsx";
import { activeStep, type StepWindow } from "../steps.ts";

export interface SceneContentProps {
  scene: ExplainerScene;
  sources: Record<string, string>;
  /** Walkthrough steps with their frame windows; empty for non-stepped scenes. */
  stepWindows?: readonly StepWindow[];
}

/**
 * Shows real captured code. For a stepped scene the view advances through the scene's steps
 * as narration plays, highlighting a few lines at a time; otherwise the scene's first
 * captured source location is shown with its highlights.
 */
export function CodeWalkthroughScene({
  scene,
  sources,
  stepWindows = [],
}: SceneContentProps) {
  const frame = useCurrentFrame();
  const changes = scene.changes ?? [];
  const active = activeStep(stepWindows, frame);

  const fallbackLocation = scene.sourceLocations.find(
    (candidate) => sources[candidate.file] !== undefined,
  );

  let location: SourceLocation | undefined;
  let highlights: CodeHighlightRange[];
  let focusLine: number;
  let transitionFromFrame = 0;
  let stepKey = "static";

  if (active !== null) {
    location =
      scene.sourceLocations.find(
        (candidate) =>
          candidate.file === active.file &&
          sources[candidate.file] !== undefined,
      ) ?? fallbackLocation;
    highlights = [{ startLine: active.startLine, endLine: active.endLine }];
    focusLine = active.startLine;
    // Step 0 is on screen from the start of the scene (the visual lead-in happens before its
    // narration window); later steps replay the scroll/highlight transition at their boundary.
    transitionFromFrame = active.stepIndex === 0 ? 0 : active.fromFrame;
    stepKey = `step-${active.stepIndex}`;
  } else {
    location = fallbackLocation;
    highlights = scene.highlights.map((highlight) => ({
      startLine: highlight.startLine,
      endLine: highlight.endLine,
    }));
    focusLine = highlights[0]?.startLine ?? location?.startLine ?? 1;
  }

  if (location === undefined) {
    return (
      <MessageCard
        title="No source captured"
        body="This scene references code that was not captured in the plan's source snapshot."
      />
    );
  }

  const content = sources[location.file] ?? "";
  const language =
    changes.find((change) => change.path === location.file)?.language ?? "text";

  return (
    <CodeFrame
      key={stepKey}
      file={location.file}
      language={language}
      content={content}
      highlights={highlights}
      focusLine={focusLine}
      startFrame={transitionFromFrame}
    />
  );
}
