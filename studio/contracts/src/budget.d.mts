// Type declarations for the spend ledger (avg-91o).
// Kept alongside budget.mjs so TypeScript consumers — the runtime, the
// gateway, Pi's tools — get the same contract it relies on at runtime.

import type { JournalActor, JournalEvent } from "./journal.mjs";

/** Money as the contracts count it: integer millionths of an ISO currency. */
export interface Money {
  currency: string;
  micros: number;
}

export interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

/** A budget as settings.yaml declares it. */
export interface BudgetEnvelope {
  currency: string;
  limitMicros: number;
  warnAtMicros: number | null;
}

export type BudgetLevel = "episode" | "series" | "channel";

export interface LegacySpend {
  byCurrency: Record<string, number>;
  costed: number;
  uncosted: number;
}

export interface OpenReservation {
  reserveId: string;
  capability: string;
  provider: string;
  profile?: string;
  purpose?: string;
  estimate: Money;
  /** False when no price was known and the estimate is a placeholder 0. */
  priced: boolean;
  at: string;
}

export interface BudgetState {
  /** The budget's currency; with no budget, the first one the ledger saw. */
  currency: string | null;
  limitMicros: number | null;
  warnAtMicros: number | null;
  /** Settled costs, plus costs older productions wrote into assets/manifest.json. */
  spentMicros: number;
  /** Open reservations: estimates of calls that were never settled or released. */
  reservedMicros: number;
  committedMicros: number;
  remainingMicros: number | null;
  warn: boolean;
  exhausted: boolean;
  counts: {
    settled: number;
    /** Settled at the estimate, because the provider reported no cost. */
    estimated: number;
    released: number;
    open: number;
    /** Calls made with no known price; their spend is unknown, not zero. */
    unpriced: number;
  };
  open: OpenReservation[];
  legacy: { micros: number; costed: number; uncosted: number } | null;
  /** Amounts in a currency other than `currency`, never summed into it. */
  otherCurrencies?: Record<string, number>;
}

export type LedgerRefusalCode =
  | "BUDGET_INVALID" | "BUDGET_CURRENCY" | "BUDGET_UNPRICED" | "BUDGET_EXCEEDED"
  | "BUDGET_UNRECORDED" | "BUDGET_UNAVAILABLE" | "BUDGET_NOT_OPEN";

export type LedgerResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; code: LedgerRefusalCode; reason: string };

export declare const PAID_CAPABILITIES: readonly string[];
export declare const BUDGET_LOCK_RESOURCE: "budget";

export declare function newReserveId(now?: number): string;
export declare function toMicros(amount: number): number;
export declare function formatMoney(micros: number, currency: string | null): string;

export declare function envelopeFromSettings(doc: unknown): BudgetEnvelope | null;
export declare function budgetSettingsFiles(root: string, ref: EpisodeRef): Array<{ file: string; level: BudgetLevel }>;
export declare function resolveBudgetEnvelope(
  root: string,
  ref: EpisodeRef,
  parse: (text: string) => unknown,
): Promise<{ envelope: BudgetEnvelope | null; from: BudgetLevel | null }>;

export declare function readLegacySpend(episodeDir: string): Promise<LegacySpend | null>;
export declare function deriveBudget(
  events: JournalEvent[],
  opts?: { envelope?: BudgetEnvelope | null; legacy?: LegacySpend | null },
): BudgetState;
export declare function readBudget(episodeDir: string, opts?: { envelope?: BudgetEnvelope | null }): Promise<BudgetState>;

export interface ReserveInput {
  episode: EpisodeRef;
  actor?: JournalActor;
  capability: string;
  provider: string;
  profile?: string;
  purpose?: string;
  estimate: Money;
  priced?: boolean;
  envelope?: BudgetEnvelope | null;
  now?: () => number;
}

interface CloseInput {
  episode: EpisodeRef;
  actor?: JournalActor;
  reserveId: string;
  now?: () => number;
}

export declare function reserveSpend(episodeDir: string, input: ReserveInput): Promise<LedgerResult<{ reserveId: string }>>;
export declare function settleSpend(
  episodeDir: string,
  input: CloseInput & { cost: Money; basis: "provider" | "estimate"; providerRequestId?: string },
): Promise<LedgerResult>;
export declare function releaseSpend(episodeDir: string, input: CloseInput & { reason: string }): Promise<LedgerResult>;

export declare class SpendRefused extends Error {
  code: LedgerRefusalCode;
  constructor(reason: string, code: LedgerRefusalCode);
}

export interface SpendCall {
  reserveId: string;
  /** The request is about to leave: from here a failure may have been billed. */
  sending(): void;
  /** The provider answered with a refusal: it did no work. */
  refused(): void;
}

export declare function withSpend<T>(
  episodeDir: string,
  reservation: ReserveInput,
  perform: (call: SpendCall) => Promise<{ value: T; cost?: Money | null; providerRequestId?: string }>,
  opts?: { onLedgerError?: (error: Error) => void },
): Promise<T>;
