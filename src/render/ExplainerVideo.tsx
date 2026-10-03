import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { resolveRenderOptions, type RenderInput } from "./RenderInput.ts";
import { SceneRenderer } from "./SceneRenderer.tsx";
import { theme } from "./theme.ts";

/**
 * Top-level composition: lays each scene out as a sequence of equal-length clips. Phase 3
 * is silent, so every scene gets the same duration; Phase 4 replaces this with real
 * narration durations from the plan.
 */
export function ExplainerVideo(input: RenderInput) {
  const { fps } = useVideoConfig();
  const options = resolveRenderOptions(input.options);
  const scenes = input.plan?.scenes ?? [];
  const sceneFrames = Math.max(1, Math.round(options.secondsPerScene * fps));

  return (
    <AbsoluteFill style={{ backgroundColor: theme.background }}>
      {scenes.map((scene, index) => (
        <Sequence
          key={scene.id}
          from={index * sceneFrames}
          durationInFrames={sceneFrames}
        >
          <SceneRenderer
            scene={scene}
            plan={input.plan}
            sources={input.sources}
            index={index}
            total={scenes.length}
            sceneStartFrame={index * sceneFrames}
            showCaptions={options.showCaptions}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
