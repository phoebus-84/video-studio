// ---------------------------------------------------------------------------
// Budget ledger — reserve, reconcile, enforce
// ---------------------------------------------------------------------------

import type { BudgetLedger, BudgetReserve } from "./types.js";

/** Error for budget violations. */
export class BudgetError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly ledger: BudgetLedger,
  ) {
    super(message);
    this.name = "BudgetError";
  }
}

export const BUDGET_CODES = {
  EXCEEDED: "BUDGET_EXCEEDED",
  OVERSPENT: "BUDGET_OVERSPENT",
  RESERVE_CONFLICT: "BUDGET_RESERVE_CONFLICT",
} as const;

/**
 * Create a new budget ledger for an episode.
 */
export function createLedger(episodeSlug: string, limit: number): BudgetLedger {
  return {
    episodeSlug,
    limit,
    reserved: 0,
    spent: 0,
    available: limit,
    reserves: [],
  };
}

/**
 * Reserve budget for a stage.
 * Concurrent reservations cannot exceed the available budget.
 */
export function reserveBudget(
  ledger: BudgetLedger,
  stageId: string,
  estimatedCost: number,
): BudgetLedger {
  if (estimatedCost > ledger.available) {
    throw new BudgetError(
      `Cannot reserve $${estimatedCost}: only $${ledger.available} available ` +
        `(limit: $${ledger.limit}, reserved: $${ledger.reserved}, spent: $${ledger.spent})`,
      BUDGET_CODES.EXCEEDED,
      ledger,
    );
  }

  const reserveId = `reserve-${stageId}-${Date.now()}`;
  const reserve: BudgetReserve = {
    reserveId,
    stageId,
    estimatedCost,
    createdAt: new Date().toISOString(),
    consumed: false,
  };

  return {
    ...ledger,
    reserved: ledger.reserved + estimatedCost,
    available: ledger.available - estimatedCost,
    reserves: [...ledger.reserves, reserve],
  };
}

/**
 * Consume a reserve (move from reserved to spent).
 * The actual cost may differ from the estimate.
 */
export function consumeReserve(
  ledger: BudgetLedger,
  reserveId: string,
  actualCost: number,
): BudgetLedger {
  const reserve = ledger.reserves.find((r) => r.reserveId === reserveId);
  if (!reserve) {
    throw new BudgetError(
      `Reserve ${reserveId} not found`,
      BUDGET_CODES.RESERVE_CONFLICT,
      ledger,
    );
  }
  if (reserve.consumed) {
    throw new BudgetError(
      `Reserve ${reserveId} already consumed`,
      BUDGET_CODES.RESERVE_CONFLICT,
      ledger,
    );
  }

  reserve.consumed = true;
  reserve.actualCost = actualCost;

  const diff = actualCost - reserve.estimatedCost;

  return {
    ...ledger,
    reserved: ledger.reserved - reserve.estimatedCost,
    spent: ledger.spent + actualCost,
    available: ledger.available + reserve.estimatedCost - actualCost,
    reserves: ledger.reserves.map((r) =>
      r.reserveId === reserveId ? reserve : r,
    ),
  };
}

/**
 * Release an unconsumed reserve (stage cancelled or completed under budget).
 */
export function releaseReserve(
  ledger: BudgetLedger,
  reserveId: string,
): BudgetLedger {
  const reserve = ledger.reserves.find((r) => r.reserveId === reserveId);
  if (!reserve || reserve.consumed) return ledger;

  return {
    ...ledger,
    reserved: ledger.reserved - reserve.estimatedCost,
    available: ledger.available + reserve.estimatedCost,
    reserves: ledger.reserves.filter((r) => r.reserveId !== reserveId),
  };
}
