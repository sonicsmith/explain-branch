import { useMemo } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import type { ThemedToken } from "shiki";
import { layout, theme } from "../theme.ts";
import { useHighlightedLines } from "../useHighlightedLines.ts";

export interface CodeHighlightRange {
  startLine: number;
  endLine: number;
}

export interface CodeFrameProps {
  file: string;
  language: string;
  content: string;
  highlights: readonly CodeHighlightRange[];
  /** Absolute line number the viewport should settle on. */
  focusLine: number;
  maxVisibleLines?: number;
  delayFrames?: number;
  /**
   * Scene-relative frame at which this view began. When a stepped scene swaps to a new
   * highlight range, the component remounts with the step's start frame so the scroll and
   * highlight animations replay from that point instead of being already complete.
   */
  startFrame?: number;
  /**
   * The focus line of the previous step. Used to slide the code from the old window to the
   * new one, so a stepped scene reads as a scroll rather than a cut.
   */
  previousFocusLine?: number;
}

export function splitLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * An editor-style frame showing real captured code with line numbers, syntax
 * highlighting, restrained scroll-into-view, and animated highlight bands (plan §9).
 */
export function CodeFrame({
  file,
  language,
  content,
  highlights,
  focusLine,
  maxVisibleLines = layout.maxVisibleLines,
  delayFrames = 6,
  startFrame = 0,
  previousFocusLine,
}: CodeFrameProps) {
  const frame = useCurrentFrame();
  const localFrame = frame - startFrame;
  const allLines = useMemo(() => splitLines(content), [content]);
  const tokens = useHighlightedLines(content, language);

  const totalLines = Math.max(1, allLines.length);
  const visible = Math.max(4, maxVisibleLines);
  const shortFile = totalLines <= visible;

  // The window is chosen so the discussed line is vertically centred in the frame.
  const windowStart = (line: number): number => {
    if (shortFile) return 1;
    const raw = line - Math.floor(visible / 2);
    return Math.min(Math.max(raw, 1), totalLines - visible + 1);
  };
  const startLineNumber = windowStart(focusLine);
  const previousStart = windowStart(previousFocusLine ?? focusLine);
  const renderCount = shortFile ? totalLines : visible;

  const enter = interpolate(localFrame, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  // Slide from the previous step's window so a stepped scene reads as a scroll, not a jump.
  const translateY = interpolate(
    enter,
    [0, 1],
    [(previousStart - startLineNumber) * layout.lineHeight, 0],
  );

  // A restrained punch-in: zoom slightly closer for a short highlight, sit back for a long one.
  const highlightLines = highlights.reduce(
    (total, range) => total + Math.max(1, range.endLine - range.startLine + 1),
    0,
  );
  const targetScale = Math.min(
    1.07,
    Math.max(1, 1.07 - Math.max(0, highlightLines - 1) * 0.006),
  );
  const scale = interpolate(
    localFrame,
    [0, 24],
    [targetScale - 0.025, targetScale],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    },
  );

  const frameOpacity = interpolate(localFrame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bandOpacity = interpolate(localFrame - delayFrames, [8, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const pointerOpacity = interpolate(
    localFrame - delayFrames,
    [14, 28],
    [0, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const pointerNudge = interpolate(
    localFrame - delayFrames,
    [14, 30],
    [-10, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    },
  );

  const rows: {
    lineNumber: number;
    plain: string;
    lineTokens?: ThemedToken[];
  }[] = [];
  for (let offset = 0; offset < renderCount; offset += 1) {
    const lineNumber = startLineNumber + offset;
    if (lineNumber > totalLines) break;
    const lineIndex = lineNumber - 1;
    const lineTokens = tokens?.[lineIndex];
    rows.push({
      lineNumber,
      plain: allLines[lineIndex] ?? "",
      ...(lineTokens === undefined ? {} : { lineTokens }),
    });
  }

  const highlightedLineNumbers = new Set<number>();
  for (const range of highlights) {
    for (let line = range.startLine; line <= range.endLine; line += 1) {
      highlightedLineNumbers.add(line);
    }
  }

  // A small arrow in the gutter marks the line (or middle of the range) being discussed.
  const pointerTop =
    (focusLine - startLineNumber) * layout.lineHeight + layout.lineHeight / 2;

  return (
    <div
      style={{
        height: "100%",
        transform: `scale(${scale})`,
        transformOrigin: "center center",
        opacity: frameOpacity,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          borderRadius: 16,
          overflow: "hidden",
          backgroundColor: theme.backgroundElevated,
          border: `1px solid ${theme.border}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            height: 62,
            padding: "0 26px",
            backgroundColor: theme.backgroundRaised,
            borderBottom: `1px solid ${theme.border}`,
          }}
        >
          <span
            style={{
              width: 13,
              height: 13,
              borderRadius: 999,
              backgroundColor: "#ff5f57",
            }}
          />
          <span
            style={{
              width: 13,
              height: 13,
              borderRadius: 999,
              backgroundColor: "#febc2e",
            }}
          />
          <span
            style={{
              width: 13,
              height: 13,
              borderRadius: 999,
              backgroundColor: "#28c840",
            }}
          />
          <span style={{ marginLeft: 14, fontSize: 25, color: theme.text }}>
            {file}
          </span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: 20,
              color: theme.textMuted,
              textTransform: "uppercase",
              letterSpacing: 1.5,
            }}
          >
            {language}
          </span>
        </div>

        <div
          style={{
            position: "relative",
            flex: 1,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              position: "relative",
              transform: `translateY(${translateY}px)`,
            }}
          >
            {pointerTop >= 0 &&
            pointerTop <= renderCount * layout.lineHeight ? (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: pointerTop - 9,
                  width: 0,
                  height: 0,
                  borderTop: "9px solid transparent",
                  borderBottom: "9px solid transparent",
                  borderLeft: `13px solid ${theme.accent}`,
                  opacity: pointerOpacity,
                  transform: `translateX(${pointerNudge}px)`,
                }}
              />
            ) : null}

            {rows.map((row) => (
              <div
                key={`band-${row.lineNumber}`}
                style={{
                  position: "absolute",
                  left: 14,
                  right: 26,
                  top: (row.lineNumber - startLineNumber) * layout.lineHeight,
                  height: layout.lineHeight,
                  borderRadius: 6,
                  backgroundColor: highlightedLineNumbers.has(row.lineNumber)
                    ? theme.highlight
                    : "transparent",
                  borderLeft: highlightedLineNumbers.has(row.lineNumber)
                    ? `4px solid ${theme.highlightBorder}`
                    : "4px solid transparent",
                  opacity: bandOpacity,
                }}
              />
            ))}

            <div style={{ position: "relative" }}>
              {rows.map((row) => (
                <div
                  key={`row-${row.lineNumber}`}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    height: layout.lineHeight,
                    fontFamily: theme.codeFont,
                    fontSize: layout.fontSize,
                    lineHeight: `${layout.lineHeight}px`,
                  }}
                >
                  <span
                    style={{
                      width: layout.gutterWidth,
                      textAlign: "right",
                      paddingRight: 24,
                      color: theme.textFaint,
                      flexShrink: 0,
                    }}
                  >
                    {row.lineNumber}
                  </span>
                  <span style={{ whiteSpace: "pre" }}>
                    {row.lineTokens === undefined ? (
                      <span style={{ color: theme.text }}>
                        {row.plain === "" ? " " : row.plain}
                      </span>
                    ) : (
                      row.lineTokens.map((token, tokenIndex) => (
                        <span
                          key={tokenIndex}
                          style={{ color: token.color ?? theme.text }}
                        >
                          {token.content}
                        </span>
                      ))
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
