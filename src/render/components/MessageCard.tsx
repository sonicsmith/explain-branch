import { theme } from "../theme.ts";

export interface MessageCardProps {
  title: string;
  body: string;
}

/** Simple informational panel used where there is no code to show. */
export function MessageCard({ title, body }: MessageCardProps) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 18,
        padding: "48px 52px",
        backgroundColor: theme.backgroundElevated,
        border: `1px solid ${theme.border}`,
        borderRadius: 16,
      }}
    >
      <span style={{ fontSize: 34, fontWeight: 600, color: theme.text }}>
        {title}
      </span>
      <span style={{ fontSize: 28, lineHeight: 1.5, color: theme.textMuted }}>
        {body}
      </span>
    </div>
  );
}
