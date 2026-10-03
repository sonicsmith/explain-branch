import type { ExplainerScene } from "../../planning/types.ts";
import { ChangeList } from "../components/ChangeList.tsx";
import { CodeFrame } from "../components/CodeFrame.tsx";
import { MessageCard } from "../components/MessageCard.tsx";

export interface SceneContentProps {
  scene: ExplainerScene;
  sources: Record<string, string>;
}

/**
 * Shows the first referenced source location that we actually captured, with the scene's
 * highlights. Falls back to a change list when no source is available.
 */
export function CodeWalkthroughScene({ scene, sources }: SceneContentProps) {
  const location = scene.sourceLocations.find(
    (candidate) => sources[candidate.file] !== undefined,
  );

  if (location === undefined) {
    return (
      <MessageCard
        title="No source captured"
        body="This scene references code that was not captured in the plan's source snapshot."
      />
    );
  }

  const content = sources[location.file] ?? "";
  const changes = scene.changes ?? [];
  const highlights = scene.highlights.map((highlight) => ({
    startLine: highlight.startLine,
    endLine: highlight.endLine,
  }));
  const focusLine = highlights[0]?.startLine ?? location.startLine;
  const language =
    changes.find((change) => change.path === location.file)?.language ?? "text";

  return (
    <div style={{ display: "flex", gap: 28, height: "100%" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <CodeFrame
          file={location.file}
          language={language}
          content={content}
          highlights={highlights}
          focusLine={focusLine}
        />
      </div>
      {changes.length > 0 ? (
        <div style={{ width: 560, flexShrink: 0 }}>
          <ChangeList changes={changes} title="Changed files" />
        </div>
      ) : null}
    </div>
  );
}
