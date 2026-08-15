import type { AssetGroup } from "$lib/asset-types";
import { getGatewayClient } from "./gateway.svelte.ts";

/**
 * Asset attempts, grouped by the production role they compete to fulfil.
 *
 * Selecting an attempt used to set `attempt.selected` on a local object and
 * tell nobody, so the choice survived exactly until the page reloaded —
 * "Selected Asset" is a core term in the domain language with, until now, no
 * endpoint behind it. Selection is now written to the episode's manifest.
 */
class AssetStore {
  groups = $state<AssetGroup[]>([]);
  selectedGroup = $state<AssetGroup | null>(null);
  /** Episode the loaded groups belong to, needed to persist a choice. */
  ref = $state<{ channel: string; series: string; episode: string } | null>(null);
  saving = $state(false);
  error = $state<string | null>(null);

  load(groups: AssetGroup[], ref?: { channel: string; series: string; episode: string }) {
    this.groups = groups;
    this.selectedGroup = this.groups[0] ?? null;
    this.ref = ref ?? null;
    this.error = null;
  }

  selectGroup(sceneId: string) {
    this.selectedGroup = this.groups.find((g) => g.sceneId === sceneId) ?? null;
  }

  /** The selected attempt within the selected group. */
  selectedAttempt = $derived(
    this.selectedGroup?.attempts.find((a) => a.selected) ?? null,
  );

  /**
   * Choose the attempt that fulfils this role.
   *
   * The local state is updated first so the click feels immediate, then
   * persisted; if the gateway refuses — a failed attempt cannot be selected —
   * the previous choice is put back rather than left lying about what is on
   * disk.
   */
  async select(attemptId: string): Promise<void> {
    const group = this.selectedGroup;
    if (!group || this.saving) return;

    const previous = group.attempts.find((a) => a.selected)?.id ?? null;
    if (previous === attemptId) return;

    const apply = (id: string | null) => {
      for (const attempt of group.attempts) attempt.selected = attempt.id === id;
    };

    apply(attemptId);
    this.error = null;

    if (!this.ref) return; // Fixture mode: nothing to persist to.

    this.saving = true;
    try {
      const { channel, series, episode } = this.ref;
      await getGatewayClient().fetchJSON(
        `/api/channels/${encodeURIComponent(channel)}/series/${encodeURIComponent(series)}` +
          `/episodes/${encodeURIComponent(episode)}/assets/select`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ attemptId }),
        },
      );
    } catch (err) {
      apply(previous);
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.saving = false;
    }
  }
}

export const assets = new AssetStore();
