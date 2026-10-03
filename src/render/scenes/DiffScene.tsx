import type { ExplainerScene } from "../../planning/types.ts";
import { ChangeList } from "../components/ChangeList.tsx";
import { MessageCard } from "../components/MessageCard.tsx";

/**
 * Deletions are shown as a diff-style summary rather than as current source, so the video
 * never implies removed code still exists (plan §9).
 */
export function DiffScene({ scene }: { scene: ExplainerScene }) {
  const changes = scene.changes ?? [];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 26,
        height: "100%",
      }}
    >
      <div style={{ height: 220, flexShrink: 0 }}>
        <MessageCard
          title="Removed or replaced code"
          body="This change deletes or replaces code, so it is summarised as a diff rather than shown as current source."
        />
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChangeList changes={changes} title="Affected files" />
      </div>
    </div>
  );
}
