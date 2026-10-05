import type { ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { layout, theme } from "../theme.ts";
import type { CaptionChunk } from "../captions.ts";

export interface SceneChromeProps {
  title: string;
  index: number;
  total: number;
  sceneStartFrame: number;
  /** Length of this scene in frames, used for the exit transition. */
  durationInFrames: number;
  captions: CaptionChunk[];
  showCaption: boolean;
  children: ReactNode;
}

/** Shared frame for every scene: title, scene counter, optional caption, progress bar. */
export function SceneChrome({
  title,
  index,
  total,
  sceneStartFrame,
  durationInFrames: sceneDurationInFrames,
  captions,
  showCaption,
  children,
}: SceneChromeProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Scenes ease in from below and scale up slightly, then ease out at the end, so cuts between
  // pages read as considered transitions rather than hard jumps. Kept short and subtle.
  const enter = interpolate(frame, [0, 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const exitStart = Math.max(1, sceneDurationInFrames - 14);
  const exit = interpolate(
    frame,
    [exitStart, Math.max(exitStart + 1, sceneDurationInFrames - 1)],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.in(Easing.cubic),
    },
  );
  const sceneOpacity = Math.min(enter, exit);
  const sceneTranslateY =
    interpolate(enter, [0, 1], [36, 0]) + interpolate(exit, [0, 1], [0, -24]);
  const sceneScale = interpolate(enter, [0, 1], [0.985, 1]);

  const titleOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const activeCaption =
    showCaption && captions.length > 0
      ? (captions.find(
          (chunk) =>
            frame >= chunk.fromFrame &&
            frame < chunk.fromFrame + chunk.durationInFrames,
        ) ??
        captions[captions.length - 1] ??
        null)
      : null;
  const captionOpacity =
    activeCaption === null
      ? 0
      : interpolate(
          frame,
          [activeCaption.fromFrame, activeCaption.fromFrame + 8],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );

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
      <AbsoluteFill
        style={{
          opacity: sceneOpacity,
          transform: `translateY(${sceneTranslateY}px) scale(${sceneScale})`,
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

        {activeCaption !== null ? (
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
              {activeCaption.text}
            </div>
          </div>
        ) : null}
      </AbsoluteFill>

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
