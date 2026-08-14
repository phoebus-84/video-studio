import type { AssetGroup } from "$lib/asset-types";

class AssetStore {
  groups = $state<AssetGroup[]>([]);
  selectedGroup = $state<AssetGroup | null>(null);

  load(groups: AssetGroup[]) {
    this.groups = groups;
    this.selectedGroup = this.groups[0] ?? null;
  }

  selectGroup(sceneId: string) {
    this.selectedGroup = this.groups.find((g) => g.sceneId === sceneId) ?? null;
  }

  /** The selected attempt within the selected group. */
  selectedAttempt = $derived(
    this.selectedGroup?.attempts.find((a) => a.selected) ?? null,
  );
}

export const assets = new AssetStore();
