import {
  resolveRenderOptions,
  totalDurationInFrames,
  type RenderInput,
} from "./RenderInput.ts";
import { ExplainerVideo } from "./ExplainerVideo.tsx";
import { sampleInput } from "./fixtures/sampleInput.ts";
import { Composition, type AnyZodObject } from "remotion";

/**
 * Registered compositions. `ExplainBranch` renders the fixture plan by default; pass
 * `--props=<file>` to render a plan produced by `npm run plan`.
 */
export function RemotionRoot() {
  const options = resolveRenderOptions(sampleInput.options);

  return (
    <Composition<AnyZodObject, RenderInput>
      id="ExplainBranch"
      component={ExplainerVideo}
      durationInFrames={totalDurationInFrames(sampleInput)}
      fps={options.fps}
      width={options.width}
      height={options.height}
      defaultProps={sampleInput}
      calculateMetadata={({ props }) => {
        const resolved = resolveRenderOptions(props.options);
        return {
          durationInFrames: totalDurationInFrames(props),
          fps: resolved.fps,
          width: resolved.width,
          height: resolved.height,
        };
      }}
    />
  );
}
