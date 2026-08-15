// ── Budget ──────────────────────────────────────────────────────────────────
//
// This endpoint used to return a fixed object:
//
//   { currency: "USD", limitMicros: 5_000_000, consumedMicros: 0, ... }
//
// A $5 limit and zero spend, for every episode, regardless of what had been
// generated or what any budget was set to. In a system whose premise is that
// nothing is fabricated, a spend figure invented out of nothing is the worst
// possible thing to make up: it is the number an operator would trust to decide
// whether to keep going.
//
// Everything here is read from disk, and the response names where each figure
// came from so it can be checked rather than believed.
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { channelPath, seriesPath, episodePath } from "@studio/contracts/src/layout.mjs";

/** Money as the contracts define it: an integer count of millionths. */
interface Money {
  currency: string;
  micros: number;
}

interface BudgetEnvelope {
  currency: string;
  limitMicros: number;
  warnAtMicros?: number;
}

export interface BudgetReport {
  /** Null when no budget is configured. Absence is reported, never invented. */
  limitMicros: number | null;
  consumedMicros: number;
  /** Null when there is no limit to subtract from. */
  remainingMicros: number | null;
  currency: string | null;
  /** True once spend has passed the configured warning threshold. */
  warn: boolean;
  /** True once spend has reached the limit. */
  exhausted: boolean;
  /** Where each figure came from, so the numbers can be audited. */
  sources: {
    /** Settings file the limit was read from, or null when none sets one. */
    limitFrom: string | null;
    /** How many asset attempts contributed a recorded cost. */
    costedAttempts: number;
    /** Attempts with no cost recorded; their spend is unknown, not zero. */
    uncostedAttempts: number;
    /** Currencies seen, when attempts disagree. */
    mixedCurrencies?: string[];
  };
}

async function readYaml(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = parseYaml(await fs.readFile(file, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asEnvelope(value: unknown): BudgetEnvelope | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const limit = raw.limitMicros;
  if (typeof limit !== "number" || !Number.isFinite(limit)) return null;
  return {
    currency: typeof raw.currency === "string" ? raw.currency : "USD",
    limitMicros: limit,
    warnAtMicros: typeof raw.warnAtMicros === "number" ? raw.warnAtMicros : undefined,
  };
}

/**
 * The budget governing an episode.
 *
 * Settings inherit episode -> series -> channel, so the nearest declaration
 * wins. Nothing is defaulted: an episode under no budget reports no budget.
 */
async function resolveLimit(
  root: string,
  p: { channel: string; series: string; episode: string },
): Promise<{ envelope: BudgetEnvelope | null; from: string | null }> {
  const candidates: Array<[string, string]> = [
    [path.join(episodePath(root, p.channel, p.series, p.episode), "settings.yaml"), "episode"],
    [path.join(seriesPath(root, p.channel, p.series), "settings.yaml"), "series"],
    [path.join(channelPath(root, p.channel), "settings.yaml"), "channel"],
  ];

  for (const [file, level] of candidates) {
    const doc = await readYaml(file);
    const envelope = asEnvelope(doc?.budget);
    if (envelope) return { envelope, from: level };
  }
  return { envelope: null, from: null };
}

/**
 * Spend recorded against an episode.
 *
 * Every generated asset records what it cost alongside its provenance, so the
 * manifest is the auditable record. An attempt with no cost is counted
 * separately rather than treated as free — unknown is not zero.
 */
async function consumedFrom(
  root: string,
  p: { channel: string; series: string; episode: string },
): Promise<{ micros: number; costed: number; uncosted: number; currencies: Set<string> }> {
  const file = path.join(
    episodePath(root, p.channel, p.series, p.episode),
    "assets",
    "manifest.json",
  );

  let manifest: { assets?: Array<{ attempts?: Array<{ cost?: Money }> }> };
  try {
    manifest = JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return { micros: 0, costed: 0, uncosted: 0, currencies: new Set() };
  }

  let micros = 0;
  let costed = 0;
  let uncosted = 0;
  const currencies = new Set<string>();

  for (const group of manifest.assets ?? []) {
    for (const attempt of group.attempts ?? []) {
      const cost = attempt.cost;
      if (cost && typeof cost.micros === "number") {
        micros += cost.micros;
        costed++;
        if (cost.currency) currencies.add(cost.currency);
      } else {
        uncosted++;
      }
    }
  }

  return { micros, costed, uncosted, currencies };
}

export async function buildBudgetReport(
  root: string,
  p: { channel: string; series: string; episode: string },
): Promise<BudgetReport> {
  const [{ envelope, from }, spend] = await Promise.all([
    resolveLimit(root, p),
    consumedFrom(root, p),
  ]);

  const limitMicros = envelope?.limitMicros ?? null;
  const currency = envelope?.currency ?? [...spend.currencies][0] ?? null;

  return {
    limitMicros,
    consumedMicros: spend.micros,
    remainingMicros: limitMicros === null ? null : limitMicros - spend.micros,
    currency,
    warn: envelope?.warnAtMicros !== undefined && spend.micros >= envelope.warnAtMicros,
    exhausted: limitMicros !== null && spend.micros >= limitMicros,
    sources: {
      limitFrom: from,
      costedAttempts: spend.costed,
      uncostedAttempts: spend.uncosted,
      // Summing across currencies would produce a meaningless total, so the
      // disagreement is reported rather than hidden.
      ...(spend.currencies.size > 1 ? { mixedCurrencies: [...spend.currencies] } : {}),
    },
  };
}

export function registerBudgetRoutes(app: FastifyInstance, root: string): void {
  app.get("/api/channels/:channel/series/:series/episodes/:episode/budget", {
    schema: {
      description: "Budget limit and recorded spend for an episode, read from disk.",
      tags: ["production"],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const p = request.params as { channel: string; series: string; episode: string };
    return reply.send(await buildBudgetReport(root, p));
  });
}
