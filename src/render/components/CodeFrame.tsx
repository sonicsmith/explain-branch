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
}: CodeFrameProps) {
  const frame = useCurrentFrame();
  const allLines = useMemo(() => splitLines(content), [content]);
  const tokens = useHighlightedLines(content, language);

  const totalLines = Math.max(1, allLines.length);
  const maxVisible = Math.max(4, maxVisibleLines);
  const maxStart = Math.max(1, totalLines - maxVisible + 1);

  const target = Math.min(
    Math.max(focusLine - Math.floor(maxVisible / 3), 1),
    maxStart,
  );
  const lead = Math.min(4, target - 1);
  const startLineNumber = Math.max(1, target - lead);

  const scrollProgress = interpolate(frame - delayFrames, [0, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const translateY = -lead * layout.lineHeight * scrollProgress;

  const highlightOpacity = interpolate(frame - delayFrames, [16, 34], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const frameOpacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const renderCount = maxVisible + lead + 1;
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
      if (line >= startLineNumber && line < startLineNumber + renderCount) {
        highlightedLineNumbers.add(line);
      }
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderRadius: 16,
        overflow: "hidden",
        backgroundColor: theme.backgroundElevated,
        border: `1px solid ${theme.border}`,
        opacity: frameOpacity,
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

      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 20,
            transform: `translateY(${translateY}px)`,
          }}
        >
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
                opacity: highlightOpacity,
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
  );
}
