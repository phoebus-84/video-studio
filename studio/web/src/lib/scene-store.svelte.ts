import type { SceneSummary } from "$lib/scene-types";

class SceneStore {
  scenes = $state<SceneSummary[]>([]);
  selectedSceneId = $state<string | null>(null);

  load(scenes: SceneSummary[]) {
    this.scenes = scenes;
    this.selectedSceneId = null;
  }

  select(sceneId: string) {
    this.selectedSceneId = sceneId;
  }

  /** Total duration across all scenes. */
  totalDuration = $derived(
    this.scenes.reduce((sum, s) => sum + s.durationSeconds, 0),
  );
}

export const scenes = new SceneStore();
