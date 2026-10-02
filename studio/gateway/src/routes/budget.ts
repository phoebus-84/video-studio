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
// It then read costs from `assets/manifest.json` — which nothing in the tree
// writes, so an episode that bought forty images reported $0. Since avg-91o
// the spend is the journal's ledger: Pi's paid tools reserve an estimate
// before the provider is called and settle it after, and this replays those
// records through the same derivation the stage guard and `vpr budget` use.
// Costs older productions did write to the manifest still count, reported
// apart. The response names where each figure came from so it can be checked
// rather than believed.
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { readEpisodeBudget, type BudgetReport as LedgerReport } from "@studio/runtime";
import { releaseSpend } from "@studio/contracts/src/budget.mjs";
import { episodePath } from "@studio/contracts/src/layout.mjs";

type EpisodeParams = { channel: string; series: string; episode: string };

export interface BudgetReport {
  /** Null when no budget is configured. Absence is reported, never invented. */
  limitMicros: number | null;
  /** Spent: settled calls, plus costs older productions recorded. */
  consumedMicros: number;
  /** Estimates of calls reserved and never settled or released. They count. */
  reservedMicros: number;
  /** Consumed plus reserved: what the limit is checked against. */
  committedMicros: number;
  /** Null when there is no limit to subtract from. Negative when overspent. */
  remainingMicros: number | null;
  currency: string | null;
  /** True once committed spend has passed the configured warning threshold. */
  warn: boolean;
  /** True once committed spend has reached the limit. */
  exhausted: boolean;
  /** The open reservations, so an operator can check and release them. */
  open: LedgerReport["open"];
  /** Where each figure came from, so the numbers can be audited. */
  sources: {
    /** Settings level the limit was read from, or null when none sets one. */
    limitFrom: "episode" | "series" | "channel" | null;
    /** Calls settled; of those, how many at the estimate (no cost reported). */
    settledCalls: number;
    estimatedCalls: number;
    releasedCalls: number;
    openCalls: number;
    /** Calls made with no known price: their spend is unknown, not zero. */
    unpricedCalls: number;
    /** Legacy asset attempts with a cost in assets/manifest.json. */
    costedAttempts: number;
    /** Legacy attempts with no cost recorded; their spend is unknown, not zero. */
    uncostedAttempts: number;
    /** Currencies seen, when amounts disagree; others are never summed in. */
    mixedCurrencies?: string[];
  };
}

function toReport(ledger: LedgerReport): BudgetReport {
  const other = Object.keys(ledger.otherCurrencies ?? {});
  return {
    limitMicros: ledger.limitMicros,
    consumedMicros: ledger.spentMicros,
    reservedMicros: ledger.reservedMicros,
    committedMicros: ledger.committedMicros,
    remainingMicros: ledger.remainingMicros,
    currency: ledger.currency,
    warn: ledger.warn,
    exhausted: ledger.exhausted,
    open: ledger.open,
    sources: {
      limitFrom: ledger.limitFrom,
      settledCalls: ledger.counts.settled,
      estimatedCalls: ledger.counts.estimated,
      releasedCalls: ledger.counts.released,
      openCalls: ledger.counts.open,
      unpricedCalls: ledger.counts.unpriced,
      costedAttempts: ledger.legacy?.costed ?? 0,
      uncostedAttempts: ledger.legacy?.uncosted ?? 0,
      // Summing across currencies would produce a meaningless total, so the
      // disagreement is reported rather than hidden.
      ...(other.length > 0 ? { mixedCurrencies: [...(ledger.currency ? [ledger.currency] : []), ...other] } : {}),
    },
  };
}

export async function buildBudgetReport(root: string, p: EpisodeParams): Promise<BudgetReport> {
  return toReport(await readEpisodeBudget(root, p));
}

export function registerBudgetRoutes(app: FastifyInstance, root: string): void {
  app.get("/api/channels/:channel/series/:series/episodes/:episode/budget", {
    schema: {
      description: "Budget limit and the spend ledger for an episode, read from the journal.",
      tags: ["production"],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const p = request.params as EpisodeParams;
    try {
      return reply.send(await buildBudgetReport(root, p));
    } catch (e) {
      // A ledger that cannot be read is not a ledger that says $0.
      return reply.code(500).send({
        error: "BUDGET_UNREADABLE",
        message: `The episode's spend ledger cannot be read: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  });

  // Closing an open reservation as spending nothing frees budget, so it is
  // the operator's alone: an agent that could release its own reservations
  // would have no cap. It is for a call that died between reserving and
  // settling, after checking the provider's dashboard.
  app.post("/api/channels/:channel/series/:series/episodes/:episode/budget/reservations/:reserveId/release", {
    schema: {
      description: "Release an open spend reservation (operator only).",
      tags: ["production"],
      body: {
        type: "object",
        additionalProperties: false,
        properties: { note: { type: "string", maxLength: 2000 } },
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { reserveId, ...p } = request.params as EpisodeParams & { reserveId: string };
    if (request.principal !== "operator") {
      return reply.code(403).send({
        error: "OPERATOR_REQUIRED",
        message: "Only the operator can release a reservation: it frees budget. Nothing was recorded.",
      });
    }
    const note = (request.body as { note?: string } | undefined)?.note?.trim();
    const released = await releaseSpend(episodePath(root, p.channel, p.series, p.episode), {
      episode: p, actor: "human", reserveId,
      reason: note ? `released by the operator: ${note}` : "released by the operator",
    });
    if (!released.ok) {
      const code = released.code === "BUDGET_NOT_OPEN" ? 409 : released.code === "BUDGET_INVALID" ? 400 : 503;
      return reply.code(code).send({ error: released.code, message: released.reason });
    }
    return reply.send({ released: reserveId, budget: await buildBudgetReport(root, p) });
  });
}
