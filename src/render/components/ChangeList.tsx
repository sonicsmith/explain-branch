import type { SceneChange } from "../../planning/types.ts";
import { changeColor, changeLetter, theme } from "../theme.ts";

export interface ChangeListProps {
  changes: readonly SceneChange[];
  title?: string;
  fontSize?: number;
}

/** Compact list of the files a scene touches, with change type and line counts. */
export function ChangeList({ changes, title, fontSize = 24 }: ChangeListProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: theme.backgroundElevated,
        border: `1px solid ${theme.border}`,
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      {title === undefined ? null : (
        <div
          style={{
            padding: "20px 24px",
            borderBottom: `1px solid ${theme.border}`,
            backgroundColor: theme.backgroundRaised,
            fontSize: 24,
            fontWeight: 600,
            color: theme.text,
          }}
        >
          {title}
        </div>
      )}

      <div
        style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        {changes.map((change) => (
          <div
            key={`${change.changeType}:${change.path}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "14px 24px",
              borderBottom: `1px solid ${theme.border}`,
            }}
          >
            <span
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                fontWeight: 700,
                color: theme.background,
                backgroundColor: changeColor(change.changeType),
              }}
            >
              {changeLetter(change.changeType)}
            </span>

            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize,
                color: theme.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {change.oldPath === undefined
                ? change.path
                : `${change.oldPath} → ${change.path}`}
            </span>

            <span
              style={{
                flexShrink: 0,
                fontSize: fontSize - 4,
                color: theme.added,
              }}
            >
              +{change.addedLines}
            </span>
            <span
              style={{
                flexShrink: 0,
                fontSize: fontSize - 4,
                color: theme.deleted,
              }}
            >
              −{change.deletedLines}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
