// ---------------------------------------------------------------------------
// Production context injection
// ---------------------------------------------------------------------------
// Gathers current production state (pipeline, budget, staleness, reviews)
// and formats it as a compact context string for injection into the Pi model
// without flooding the model window.
// ---------------------------------------------------------------------------

import { resolveConfig } from "../src/config.js";
import type { SkillCatalog } from "../src/skills.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ProductionContext {
  /** Episode slug. */
  episodeSlug: string;
  /** Pipeline name and snapshot version. */
  pipeline: { name: string; version: number };
  /** Stage progress summary. */
  stages: { id: string; state: string; completedAt?: string }[];
  /** Budget status in human-readable format. */
  budget: { currency: string; limitMicros: number; consumedMicros: number; remainingMicros: number };
  /** Stale artifact count. */
  staleness: { staleCount: number; affectedCount: number };
  /** Open review threads count. */
  reviews: { openCount: number; totalCount: number };
  /** Timestamp of context snapshot. */
  capturedAt: string;
}

export interface ContextInjection {
  /** Compact markdown summary for Pi system prompt. */
  summary: string;
  /** Structured data for tools. */
  data: ProductionContext;
  /** Whether any production-blocking issues exist. */
  hasBlockers: boolean;
  /** Skill catalog (reference, not loaded content). */
  availableSkills: string[];
}

// ── Gateway client ──────────────────────────────────────────────────────────

interface GatewayClient {
  fetch(path: string): Promise<any>;
}

function createClient(baseUrl: string, token: string): GatewayClient {
  return {
    async fetch(path) {
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}${path}`, { headers });
      if (!res.ok) throw new Error(`Gateway ${res.status}`);
      return res.json();
    },
  };
}

// ── Context builder ─────────────────────────────────────────────────────────

export function normalizeEpisodeStatus(status: any): {
  pipeline: { name: string; version: number };
  stages: { id: string; state: string }[];
  hasBlockers: boolean;
} {
  const pipelineName = typeof status?.pipeline === "string"
    ? status.pipeline
    : (status?.pipeline?.name ?? "unknown");
  return {
    pipeline: { name: pipelineName, version: status?.snapshot?.version ?? status?.pipeline?.version ?? 0 },
    stages: Array.isArray(status?.stages)
      ? status.stages.map((stage: any) => ({ ...stage, state: stage.state ?? stage.status ?? "pending" }))
      : [],
    hasBlockers: Array.isArray(status?.blockers) && status.blockers.length > 0,
  };
}

/**
 * Gather current production context for an episode.
 * Fetches pipeline state, budget, staleness, and reviews from the gateway.
 */
export async function gatherContext(
  channel: string,
  series: string,
  episode: string,
  skillCatalog?: SkillCatalog,
): Promise<ContextInjection> {
  const config = await resolveConfig();
  const client = createClient(config.gatewayUrl, config.gatewayToken);
  const slug = `${channel}/${series}/${episode}`;
  const now = new Date().toISOString();

  let pipeline = { name: "unknown", version: 0 };
  let stages: { id: string; state: string }[] = [];
  let budget = { currency: "USD", limitMicros: 0, consumedMicros: 0, remainingMicros: 0 };
  let staleness = { staleCount: 0, affectedCount: 0 };
  let reviews = { openCount: 0, totalCount: 0 };
  let hasBlockers = false;

  // Try to fetch status from gateway
  try {
    const status = await client.fetch(`/api/channels/${channel}/series/${series}/episodes/${episode}`);
    const normalized = normalizeEpisodeStatus(status);
    pipeline = normalized.pipeline;
    stages = normalized.stages;
    hasBlockers = normalized.hasBlockers;
  } catch {
    // Gateway not available — use defaults
  }

  // Budget
  try {
    const budgetData = await client.fetch(`/api/channels/${channel}/series/${series}/episodes/${episode}/budget`);
    budget = {
      currency: budgetData.currency ?? "USD",
      limitMicros: budgetData.limitMicros ?? 0,
      consumedMicros: budgetData.consumedMicros ?? 0,
      remainingMicros: budgetData.remainingMicros ?? budgetData.limitMicros ?? 0,
    };
  } catch { /* use defaults */ }

  // Staleness
  try {
    const st = await client.fetch(`/api/channels/${channel}/series/${series}/episodes/${episode}/staleness`);
    staleness = {
      staleCount: st.stale?.length ?? 0,
      affectedCount: st.affected?.length ?? 0,
    };
  } catch { /* use defaults */ }

  // Reviews
  try {
    const rev = await client.fetch(`/api/channels/${channel}/series/${series}/episodes/${episode}/reviews`);
    reviews = {
      totalCount: rev.threads?.length ?? 0,
      openCount: rev.threads?.filter((t: any) => t.messages?.some((m: any) => m.status === "open")).length ?? 0,
    };
  } catch { /* use defaults */ }

  const data: ProductionContext = {
    episodeSlug: slug,
    pipeline,
    stages,
    budget,
    staleness,
    reviews,
    capturedAt: now,
  };

  const availableSkills = skillCatalog
    ? skillCatalog.list({ seriesSlug: `${channel}/${series}` }).map((s) => s.id)
    : [];

  // Build compact summary
  const completedStages = stages.filter((s) => s.state === "completed").length;
  const totalStages = stages.length;
  const budgetDollars = (budget.consumedMicros / 1_000_000).toFixed(2);

  const summary = [
    `**Production: ${slug}**`,
    `Pipeline: ${pipeline.name} (v${pipeline.version}) — ${completedStages}/${totalStages} stages complete`,
    `Budget: $${budgetDollars} consumed of $${(budget.limitMicros / 1_000_000).toFixed(2)}`,
    staleness.staleCount > 0
      ? `⚠️ ${staleness.staleCount} stale artifact(s), ${staleness.affectedCount} affected`
      : "✓ No stale artifacts",
    reviews.openCount > 0
      ? `📝 ${reviews.openCount} open review thread(s)`
      : "",
    hasBlockers ? "🚫 Production has blocking issues" : "",
    availableSkills.length > 0
      ? `Skills available: ${availableSkills.slice(0, 10).join(", ")}${availableSkills.length > 10 ? ` +${availableSkills.length - 10} more` : ""}`
      : "",
  ].filter(Boolean).join("\n");

  return {
    summary,
    data,
    hasBlockers,
    availableSkills,
  };
}
