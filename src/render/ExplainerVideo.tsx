import { AbsoluteFill, Sequence } from "remotion";
import {
  buildRenderTimeline,
  resolveRenderOptions,
  type RenderInput,
} from "./RenderInput.ts";
import { SceneRenderer } from "./SceneRenderer.tsx";
import { theme } from "./theme.ts";

/**
 * Top-level composition. Each scene is a `<Sequence>` whose length comes from the
 * narration-driven timeline: scenes with `narrationDurationMs` run for
 * lead-in + narration + tail (+ gap), while silent scenes fall back to `secondsPerScene`.
 */
export function ExplainerVideo(input: RenderInput) {
  const options = resolveRenderOptions(input.options);
  const scenes = input.plan?.scenes ?? [];
  const timeline = buildRenderTimeline(input);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.background }}>
      {scenes.map((scene, index) => {
        const timing = timeline.scenes[index];
        const fallbackFrames = Math.max(
          1,
          Math.round(options.secondsPerScene * timeline.fps),
        );
        const durationInFrames = timing?.durationInFrames ?? fallbackFrames;
        const from = timing?.fromFrame ?? index * fallbackFrames;

        return (
          <Sequence
            key={scene.id}
            from={from}
            durationInFrames={durationInFrames}
          >
            <SceneRenderer
              scene={scene}
              plan={input.plan}
              sources={input.sources}
              index={index}
              total={scenes.length}
              timeline={timing}
              sceneStartFrame={from}
              showCaptions={options.showCaptions}
              fps={timeline.fps}
              {...(options.audioBaseUrl !== undefined
                ? { audioBaseUrl: options.audioBaseUrl }
                : {})}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
