import { Audio, Sequence } from "remotion";
import type { ExplainerPlan, ExplainerScene } from "../planning/types.ts";
import { resolveAudioSrc } from "./audioSource.ts";
import { buildSceneCaptions } from "./captions.ts";
import { buildStepWindows, type StepWindow } from "./steps.ts";
import type { SceneTiming } from "./timeline.ts";
import { SceneChrome } from "./components/SceneChrome.tsx";
import { ArchitectureScene } from "./scenes/ArchitectureScene.tsx";
import { CodeWalkthroughScene } from "./scenes/CodeWalkthroughScene.tsx";
import { DiffScene } from "./scenes/DiffScene.tsx";
import { SummaryScene } from "./scenes/SummaryScene.tsx";

export interface SceneRendererProps {
  scene: ExplainerScene;
  plan: ExplainerPlan;
  sources: Record<string, string>;
  index: number;
  total: number;
  /** Timing for this scene from the narration-driven timeline. */
  timeline: SceneTiming | undefined;
  sceneStartFrame: number;
  showCaptions: boolean;
  fps: number;
  audioBaseUrl?: string;
}

export function SceneRenderer(props: SceneRendererProps) {
  const {
    scene,
    plan,
    sources,
    index,
    total,
    timeline,
    sceneStartFrame,
    showCaptions,
    fps,
    audioBaseUrl,
  } = props;

  const captions = buildSceneCaptions(scene, timeline, fps);
  const stepWindows = buildStepWindows(scene, timeline, fps);

  const audioSrc =
    scene.narrationAudioPath !== undefined
      ? resolveAudioSrc(
          scene.narrationAudioPath,
          audioBaseUrl !== undefined ? { audioBaseUrl } : {},
        )
      : null;

  return (
    <>
      {audioSrc !== null ? (
        // Start the clip after the visual lead-in so the code settles before the first words.
        <Sequence from={timeline?.narrationStartFrame ?? 0}>
          <Audio src={audioSrc} volume={1} name={`narration-${scene.id}`} />
        </Sequence>
      ) : null}
      <SceneChrome
        title={scene.title}
        index={index}
        total={total}
        sceneStartFrame={sceneStartFrame}
        durationInFrames={
          timeline?.durationInFrames ?? Math.max(1, Math.round(fps * 8))
        }
        captions={captions}
        showCaption={showCaptions}
      >
        {renderSceneContent(scene, plan, sources, stepWindows)}
      </SceneChrome>
    </>
  );
}

function renderSceneContent(
  scene: ExplainerScene,
  plan: ExplainerPlan,
  sources: Record<string, string>,
  stepWindows: readonly StepWindow[],
) {
  switch (scene.visual) {
    case "code-walkthrough":
      return (
        <CodeWalkthroughScene
          scene={scene}
          sources={sources}
          stepWindows={stepWindows}
        />
      );
    case "diff":
      return <DiffScene scene={scene} />;
    case "architecture":
      return <ArchitectureScene scene={scene} />;
    case "summary":
      return <SummaryScene scene={scene} plan={plan} />;
    default:
      return <DiffScene scene={scene} />;
  }
}
