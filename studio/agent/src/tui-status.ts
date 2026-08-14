// ---------------------------------------------------------------------------
// TUI production status and approvals
// ---------------------------------------------------------------------------

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

interface EpisodeStatus {
  slug: string;
  pipeline: string;
  stageCount: number;
  completedCount: number;
  budgetUsed: number;
  budgetLimit: number;
  staleCount: number;
  blocked: boolean;
  pendingApprovals: string[];
}

interface ProductionDashboard {
  episodes: EpisodeStatus[];
  totalBudget: number;
  totalUsed: number;
  updatedAt: string;
}

class ProductionWidget {
  private data: ProductionDashboard = { episodes: [], totalBudget: 0, totalUsed: 0, updatedAt: "" };
  expanded = false;

  update(dashboard: ProductionDashboard): void { this.data = dashboard; }

  toggleExpand(): void { this.expanded = !this.expanded; }

  renderCompact(): string {
    const { episodes, totalUsed, totalBudget } = this.data;
    if (episodes.length === 0) return "No active productions";

    const total = episodes.length;
    const completed = episodes.filter((e) => e.completedCount === e.stageCount).length;
    const blocked = episodes.filter((e) => e.blocked).length;
    const stale = episodes.reduce((sum, e) => sum + e.staleCount, 0);

    const parts: string[] = [];
    parts.push(`\u{1F3AC} ${completed}/${total} done`);
    if (blocked > 0) parts.push(`\u{1F6AB} ${blocked} blocked`);
    if (stale > 0) parts.push(`\u26A0\uFE0F ${stale} stale`);
    parts.push(`$${totalUsed.toFixed(2)}/${totalBudget.toFixed(2)}`);

    return parts.join(" \u00B7 ");
  }

  renderExpanded(_width: number): string[] {
    const { episodes, totalUsed, totalBudget, updatedAt } = this.data;
    const lines: string[] = [];

    lines.push("\u256D\u2500\u2500 Production Dashboard \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256E");
    lines.push(`\u2502 ${episodes.length} episodes \u00B7 Budget: $${totalUsed.toFixed(2)}/${totalBudget.toFixed(2)} \u00B7 ${updatedAt.slice(0, 19)} \u2502`);
    lines.push("\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u251C");

    if (episodes.length === 0) {
      lines.push("\u2502 No active productions                                          \u2502");
    } else {
      for (const ep of episodes.slice(0, 10)) {
        const progress = `${ep.completedCount}/${ep.stageCount} stages`;
        const flags: string[] = [];
        if (ep.blocked) flags.push("\u{1F6AB}");
        if (ep.staleCount > 0) flags.push(`\u26A0\uFE0F${ep.staleCount}`);
        if (ep.pendingApprovals.length > 0) flags.push(`\u270B${ep.pendingApprovals.length}`);

        const flagStr = flags.length > 0 ? ` ${flags.join(" ")}` : "";
        const slug = ep.slug.slice(-40);
        lines.push(`\u2502 ${slug.padEnd(40)} ${progress.padEnd(20)}${flagStr} \u2502`);
      }
      if (episodes.length > 10) {
        lines.push(`\u2502 ... and ${episodes.length - 10} more                         \u2502`);
      }
    }
    lines.push("\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F");
    return lines;
  }
}

// ── Gateway fetch ──────────────────────────────────────────────────────────

async function fetchDashboard(): Promise<ProductionDashboard> {
  const gatewayUrl = process.env.AVG_GATEWAY_URL ?? "http://127.0.0.1:5198";
  const token = process.env.AVG_GATEWAY_TOKEN ?? "";
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const res = await fetch(`${gatewayUrl}/api/channels`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Gateway ${res.status}`);

    const channels = (await res.json()) as any[];
    const episodes: EpisodeStatus[] = [];
    let totalBudget = 0;
    let totalUsed = 0;

    for (const channel of channels ?? []) {
      try {
        const seriesRes = await fetch(`${gatewayUrl}/api/channels/${channel.slug}/series`, { headers });
        if (!seriesRes.ok) continue;
        const seriesList = (await seriesRes.json()) as any[];

        for (const series of seriesList ?? []) {
          try {
            const epRes = await fetch(`${gatewayUrl}/api/channels/${channel.slug}/series/${series.slug}/episodes`, { headers });
            if (!epRes.ok) continue;
            const epList = (await epRes.json()) as any[];

            for (const ep of epList ?? []) {
              const slug = `${channel.slug}/${series.slug}/${ep.slug}`;
              let budgetUsed = 0;
              let budgetLimit = 0;

              try {
                const budgetRes = await fetch(
                  `${gatewayUrl}/api/channels/${channel.slug}/series/${series.slug}/episodes/${ep.slug}/budget`,
                  { headers },
                );
                if (budgetRes.ok) {
                  const b = (await budgetRes.json()) as { consumedMicros?: number; limitMicros?: number };
                  budgetUsed = (b.consumedMicros ?? 0) / 1_000_000;
                  budgetLimit = (b.limitMicros ?? 0) / 1_000_000;
                }
              } catch { /* defaults */ }

              episodes.push({
                slug,
                pipeline: ep.pipeline ?? "unknown",
                stageCount: 0,
                completedCount: 0,
                budgetUsed,
                budgetLimit,
                staleCount: 0,
                blocked: false,
                pendingApprovals: [],
              });
              totalBudget += budgetLimit;
              totalUsed += budgetUsed;
            }
          } catch { /* skip series */ }
        }
      } catch { /* skip channel */ }
    }

    return { episodes, totalBudget, totalUsed, updatedAt: new Date().toISOString() };
  } catch {
    return { episodes: [], totalBudget: 0, totalUsed: 0, updatedAt: new Date().toISOString() };
  }
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerTuiComponents(pi: ExtensionAPI): void {
  const widget = new ProductionWidget();
  let interval: ReturnType<typeof setInterval> | null = null;

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setStatus("pva-prod", "\u{1F3AC} Starting...");

    interval = setInterval(async () => {
      try {
        const d = await fetchDashboard();
        widget.update(d);
        ctx.ui.setStatus("pva-prod", widget.renderCompact());

        const blocked = d.episodes.filter((e) => e.blocked);
        if (blocked.length > 0 && ctx.mode === "tui") {
          ctx.ui.notify(`${blocked.length} episode(s) blocked`, "warning");
        }
      } catch {
        ctx.ui.setStatus("pva-prod", "\u{1F3AC} (offline)");
      }
    }, 30_000);

    fetchDashboard().then((d) => {
      widget.update(d);
      ctx.ui.setStatus("pva-prod", widget.renderCompact());
    }).catch(() => {
      ctx.ui.setStatus("pva-prod", "\u{1F3AC} (connecting)");
    });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (interval) { clearInterval(interval); interval = null; }
    ctx.ui.setStatus("pva-prod", "");
  });

  pi.registerCommand?.("dashboard", {
    description: "Toggle production dashboard",
    async handler(_args: string, _ctx: ExtensionCommandContext) {
      widget.toggleExpand();
    },
  });
}
