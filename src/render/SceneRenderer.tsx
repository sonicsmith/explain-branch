import type { ExplainerPlan, ExplainerScene } from "../planning/types.ts";
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
  sceneStartFrame: number;
  showCaptions: boolean;
}

export function SceneRenderer(props: SceneRendererProps) {
  const { scene, plan, sources, index, total, sceneStartFrame, showCaptions } =
    props;

  return (
    <SceneChrome
      title={scene.title}
      index={index}
      total={total}
      sceneStartFrame={sceneStartFrame}
      caption={scene.narrationText}
      showCaption={showCaptions}
    >
      {renderSceneContent(scene, plan, sources)}
    </SceneChrome>
  );
}

function renderSceneContent(
  scene: ExplainerScene,
  plan: ExplainerPlan,
  sources: Record<string, string>,
) {
  switch (scene.visual) {
    case "code-walkthrough":
      return <CodeWalkthroughScene scene={scene} sources={sources} />;
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
