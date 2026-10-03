/** Shared visual constants for the explainer video (plan §9: dark editor theme). */

export const theme = {
  background: "#0d1117",
  backgroundElevated: "#161b22",
  backgroundRaised: "#1c2128",
  border: "#30363d",
  text: "#e6edf3",
  textMuted: "#8b949e",
  textFaint: "#6e7681",
  accent: "#2f81f7",
  added: "#3fb950",
  deleted: "#f85149",
  modified: "#d29922",
  renamed: "#a371f7",
  highlight: "rgba(47, 129, 247, 0.20)",
  highlightBorder: "rgba(47, 129, 247, 0.55)",
  codeFont:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  uiFont:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
} as const;

export const layout = {
  padding: 72,
  lineHeight: 34,
  fontSize: 22,
  gutterWidth: 84,
  maxVisibleLines: 22,
  headerHeight: 92,
  captionHeight: 176,
} as const;

export function changeLetter(changeType: string): string {
  switch (changeType) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "type-changed":
      return "T";
    case "modified":
      return "M";
    default:
      return "?";
  }
}

export function changeColor(changeType: string): string {
  switch (changeType) {
    case "added":
      return theme.added;
    case "deleted":
      return theme.deleted;
    case "renamed":
    case "copied":
      return theme.renamed;
    case "modified":
      return theme.modified;
    default:
      return theme.textMuted;
  }
}
