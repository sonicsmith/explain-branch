import type { ReactNode } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { layout, theme } from "../theme.ts";

export interface SceneChromeProps {
  title: string;
  index: number;
  total: number;
  sceneStartFrame: number;
  caption: string;
  showCaption: boolean;
  children: ReactNode;
}

/** Shared frame for every scene: title, scene counter, optional caption, progress bar. */
export function SceneChrome({
  title,
  index,
  total,
  sceneStartFrame,
  caption,
  showCaption,
  children,
}: SceneChromeProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const captionOpacity = interpolate(frame, [26, 48], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const globalFrame = sceneStartFrame + frame;
  const overall = Math.min(
    1,
    Math.max(0, globalFrame / Math.max(1, durationInFrames - 1)),
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.background,
        color: theme.text,
        fontFamily: theme.uiFont,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: layout.padding,
          left: layout.padding,
          right: layout.padding,
          display: "flex",
          alignItems: "center",
          opacity: titleOpacity,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <span
            style={{
              width: 6,
              height: 36,
              borderRadius: 999,
              backgroundColor: theme.accent,
            }}
          />
          <span style={{ fontSize: 42, fontWeight: 600 }}>{title}</span>
        </div>
        <span
          style={{ marginLeft: "auto", fontSize: 26, color: theme.textMuted }}
        >
          {index + 1} / {total}
        </span>
      </div>

      <div
        style={{
          position: "absolute",
          top: layout.padding + layout.headerHeight,
          left: layout.padding,
          right: layout.padding,
          bottom: layout.padding + (showCaption ? layout.captionHeight : 0),
        }}
      >
        {children}
      </div>

      {showCaption ? (
        <div
          style={{
            position: "absolute",
            left: layout.padding * 2,
            right: layout.padding * 2,
            bottom: layout.padding + 26,
            opacity: captionOpacity,
          }}
        >
          <div
            style={{
              backgroundColor: "rgba(22, 27, 34, 0.94)",
              border: `1px solid ${theme.border}`,
              borderRadius: 14,
              padding: "20px 30px",
              fontSize: 30,
              lineHeight: 1.4,
            }}
          >
            {caption}
          </div>
        </div>
      ) : null}

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 6,
          backgroundColor: theme.backgroundRaised,
        }}
      >
        <div
          style={{
            width: `${overall * 100}%`,
            height: "100%",
            backgroundColor: theme.accent,
          }}
        />
      </div>
    </AbsoluteFill>
  );
}
