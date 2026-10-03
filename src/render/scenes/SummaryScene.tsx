import type { ExplainerPlan, ExplainerScene } from "../../planning/types.ts";
import { theme } from "../theme.ts";

export interface SummarySceneProps {
  scene: ExplainerScene;
  plan: ExplainerPlan;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "24px 32px",
        minWidth: 260,
        backgroundColor: theme.backgroundElevated,
        border: `1px solid ${theme.border}`,
        borderRadius: 16,
      }}
    >
      <span
        style={{
          fontSize: 22,
          color: theme.textMuted,
          textTransform: "uppercase",
          letterSpacing: 1.5,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 40, fontWeight: 600, color: theme.text }}>
        {value}
      </span>
    </div>
  );
}

function Notes({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}
    >
      <span style={{ fontSize: 26, fontWeight: 600, color: theme.textMuted }}>
        {title}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.slice(0, 5).map((item) => (
          <span
            key={item}
            style={{ fontSize: 26, lineHeight: 1.4, color: theme.text }}
          >
            • {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export function SummaryScene({ plan }: SummarySceneProps) {
  const changes = plan.scenes.flatMap((scene) => scene.changes ?? []);
  const files = new Set(changes.map((change) => change.path)).size;
  const added = changes.reduce((total, change) => total + change.addedLines, 0);
  const deleted = changes.reduce(
    (total, change) => total + change.deletedLines,
    0,
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 34,
        height: "100%",
      }}
    >
      <div style={{ display: "flex", gap: 22 }}>
        <Stat label="Branch" value={plan.branchName} />
        <Stat label="Base" value={plan.baseRef} />
        <Stat label="Files" value={String(files)} />
        <Stat label="Lines" value={`+${added} −${deleted}`} />
      </div>

      <div style={{ display: "flex", gap: 44, flex: 1, minHeight: 0 }}>
        {plan.omissions.length > 0 ? (
          <Notes
            title="Not covered"
            items={plan.omissions.map(
              (omission) => `${omission.item} — ${omission.reason}`,
            )}
          />
        ) : null}
        {plan.caveats.length > 0 ? (
          <Notes title="Caveats" items={plan.caveats} />
        ) : null}
      </div>
    </div>
  );
}
