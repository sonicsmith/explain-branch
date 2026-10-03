import type { ExplainerScene } from "../../planning/types.ts";
import { ChangeList } from "../components/ChangeList.tsx";
import { theme } from "../theme.ts";

/**
 * Minimal diagram scene: renders nodes and edges from the plan's diagramSpec. Falls back
 * to the change list when a diagram has not been specified yet.
 */
export function ArchitectureScene({ scene }: { scene: ExplainerScene }) {
  const diagram = scene.diagramSpec;

  if (diagram === undefined) {
    return <ChangeList changes={scene.changes ?? []} title="Changes" />;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 34,
        height: "100%",
      }}
    >
      <span style={{ fontSize: 30, color: theme.textMuted }}>
        {diagram.description}
      </span>

      <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
        {diagram.nodes.map((node) => (
          <div
            key={node.id}
            style={{
              padding: "20px 30px",
              fontSize: 28,
              color: theme.text,
              backgroundColor: theme.backgroundElevated,
              border: `2px solid ${theme.accent}`,
              borderRadius: 14,
            }}
          >
            {node.label}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {diagram.edges.map((edge, index) => (
          <span key={index} style={{ fontSize: 26, color: theme.text }}>
            {edge.from} → {edge.to}
            {edge.label === undefined ? "" : ` (${edge.label})`}
          </span>
        ))}
      </div>
    </div>
  );
}
