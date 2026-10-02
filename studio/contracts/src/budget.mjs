// ---------------------------------------------------------------------------
// The spend ledger (avg-91o)
// ---------------------------------------------------------------------------
// An episode's spend is journal records, like everything else that happened to
// it. A paid call RESERVES its estimate before it reaches the provider and
// SETTLES after; a call that never got there is RELEASED. The budget is a
// replay of those three events against the nearest `budget:` in settings.yaml.
//
// There used to be a ledger in the runtime (policy/ledger.ts) with reserve,
// consume and release — on an in-memory object nothing ever created outside
// its tests — and two guards, the CLI's and the gateway's, that answered every
// question with "yes, estimate 0". Meanwhile the money was spent inside Pi's
// tools, which no stage-level guard can see. This module lives in contracts
// because those tools import contracts and nothing else from the studio.
//
// Reserving is check-then-append, and two processes (the gateway's Pi and an
// operator's terminal Pi, say) can both be reserving. The check and the append
// therefore happen under one lock — the `budget` resource in the episode's
// `.locks/`, the same directory, file format and `wx` arbitration the
// runtime's FileLock uses — and the journal is re-read under it.
//
// What this is not: a security boundary. Pi holds FAL_KEY and can reach the
// provider without a reservation, and spend lines are not signed. Both are
// the same-user boundary avg-qr4.8 owns. The ledger keeps the TOOLS honest.
// ---------------------------------------------------------------------------

import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { appendJournalEvent, parseJournal, JOURNAL_RELATIVE_PATH, ulid } from "./journal.mjs";
import { channelPath, seriesPath, episodePath } from "./layout.mjs";

/** Capabilities that cost money when a stage performs them. */
export const PAID_CAPABILITIES = Object.freeze(["image.generate", "image.edit", "video.generate"]);

/** The lock resource every ledger write takes. */
export const BUDGET_LOCK_RESOURCE = "budget";

const LOCKS_DIR = ".locks";
const LOCK_TTL_MS = 30_000;
const LOCK_WAIT_MS = 5_000;
const LOCK_POLL_MS = 25;

const RESERVE_ID = /^rsv_[0-9A-HJKMNP-TV-Z]{26}$/;
const CURRENCY = /^[A-Z]{3}$/;

/** A fresh reservation id, time-ordered like every other journal id. */
export function newReserveId(now = Date.now()) {
  return `rsv_${ulid(now)}`;
}

/**
 * A price in major units (what provider profiles carry: `0.025` dollars) as
 * the integer micros the contracts count money in. Rounded, never truncated:
 * 0.003 * 1e6 is 2999.9999999999995 in floating point.
 */
export function toMicros(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    throw new Error(`A price must be a non-negative number, not ${String(amount)}`);
  }
  return Math.round(amount * 1_000_000);
}

/** `$0.025000`-style text for refusals and reports. */
export function formatMoney(micros, currency) {
  // Six places, then trailing zeros dropped down to cents: $5.00, $0.025.
  const amount = (micros / 1_000_000).toFixed(6).replace(/(\.\d\d\d*?)0+$/, "$1");
  return currency === "USD" ? `$${amount}` : `${amount} ${currency ?? ""}`.trimEnd();
}

function isMoney(value) {
  return !!value && typeof value === "object" &&
    typeof value.currency === "string" && CURRENCY.test(value.currency) &&
    Number.isInteger(value.micros) && value.micros >= 0;
}

// ── The envelope ────────────────────────────────────────────────────────────

/**
 * The budget a parsed settings.yaml declares, or null when it declares none.
 * Top-level `budget: { currency, limitMicros, warnAtMicros? }` — the shape the
 * `/budget` route has always read. A malformed one is null too: a limit we
 * cannot read is not a limit, and inventing one would be worse.
 */
export function envelopeFromSettings(doc) {
  const raw = doc && typeof doc === "object" ? doc.budget : undefined;
  if (!raw || typeof raw !== "object") return null;
  if (!Number.isInteger(raw.limitMicros) || raw.limitMicros < 0) return null;
  const currency = typeof raw.currency === "string" && CURRENCY.test(raw.currency) ? raw.currency : "USD";
  const warn = Number.isInteger(raw.warnAtMicros) && raw.warnAtMicros >= 0 ? raw.warnAtMicros : null;
  return { currency, limitMicros: raw.limitMicros, warnAtMicros: warn };
}

/** Where an episode's budget may be declared, nearest first. */
export function budgetSettingsFiles(root, ref) {
  return [
    { file: path.join(episodePath(root, ref.channel, ref.series, ref.episode), "settings.yaml"), level: "episode" },
    { file: path.join(seriesPath(root, ref.channel, ref.series), "settings.yaml"), level: "series" },
    { file: path.join(channelPath(root, ref.channel), "settings.yaml"), level: "channel" },
  ];
}

/**
 * The budget governing an episode: the nearest declaration wins, and nothing
 * is defaulted. `parse` turns YAML text into an object — contracts carries no
 * parser of its own, and every caller already has one.
 */
export async function resolveBudgetEnvelope(root, ref, parse) {
  for (const { file, level } of budgetSettingsFiles(root, ref)) {
    let text;
    try {
      text = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    let doc;
    try {
      doc = parse(text);
    } catch {
      continue;
    }
    const envelope = envelopeFromSettings(doc);
    if (envelope) return { envelope, from: level };
  }
  return { envelope: null, from: null };
}

// ── What was spent before there was a ledger ───────────────────────────────

/**
 * Costs older productions wrote into `assets/manifest.json`. Nothing in the
 * current tree writes them, but money already spent must not read as $0 —
 * so they count as spent, and are reported apart from the journal's figures.
 */
export async function readLegacySpend(episodeDir) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(episodeDir, "assets", "manifest.json"), "utf-8"));
  } catch {
    return null;
  }
  const byCurrency = {};
  let costed = 0;
  let uncosted = 0;
  for (const group of Array.isArray(manifest?.assets) ? manifest.assets : []) {
    for (const attempt of Array.isArray(group?.attempts) ? group.attempts : []) {
      const cost = attempt?.cost;
      if (cost && typeof cost.micros === "number" && Number.isFinite(cost.micros)) {
        const currency = typeof cost.currency === "string" ? cost.currency : "USD";
        byCurrency[currency] = (byCurrency[currency] ?? 0) + cost.micros;
        costed++;
      } else {
        uncosted++;
      }
    }
  }
  return costed + uncosted === 0 ? null : { byCurrency, costed, uncosted };
}

// ── Derivation ──────────────────────────────────────────────────────────────

/**
 * Replay the spend events of one journal.
 *
 * An OPEN reservation — neither settled nor released — counts. A process that
 * died between reserving and settling may still have been billed; its
 * estimate stays committed until someone looks and closes it. The first
 * closing event for a reservation wins; any later one is ignored rather than
 * counted twice.
 *
 * Amounts in a currency other than the budget's are not summed into it —
 * a dollar total with euros in it means nothing — and are reported apart.
 */
export function deriveBudget(events, { envelope = null, legacy = null } = {}) {
  const reservations = new Map();
  const order = [];
  for (const event of events) {
    const data = event?.data;
    if (!data || typeof data.reserveId !== "string") continue;
    if (event.type === "spend-reserved") {
      if (reservations.has(data.reserveId) || !isMoney(data.estimate)) continue;
      reservations.set(data.reserveId, {
        reserveId: data.reserveId,
        capability: data.capability,
        provider: data.provider,
        ...(data.profile ? { profile: data.profile } : {}),
        ...(data.purpose ? { purpose: data.purpose } : {}),
        estimate: data.estimate,
        priced: data.priced !== false,
        at: event.at,
        closed: null,
      });
      order.push(data.reserveId);
    } else if (event.type === "spend-settled" || event.type === "spend-released") {
      const r = reservations.get(data.reserveId);
      if (!r || r.closed) continue;
      if (event.type === "spend-settled") {
        if (!isMoney(data.cost)) continue;
        r.closed = { kind: "settled", cost: data.cost, basis: data.basis === "provider" ? "provider" : "estimate", at: event.at };
      } else {
        r.closed = { kind: "released", reason: String(data.reason ?? ""), at: event.at };
      }
    }
  }

  // The budget's own currency, or — with no budget — the first one seen.
  let currency = envelope?.currency ?? null;
  if (!currency) {
    const first = order.map((id) => reservations.get(id).estimate.currency)[0];
    currency = first ?? Object.keys(legacy?.byCurrency ?? {})[0] ?? null;
  }

  const other = {};
  const addOther = (cur, micros) => { other[cur] = (other[cur] ?? 0) + micros; };

  let spent = 0;
  let reserved = 0;
  let settled = 0;
  let estimated = 0;
  let released = 0;
  let unpriced = 0;
  const open = [];
  for (const id of order) {
    const r = reservations.get(id);
    if (!r.priced && r.closed?.kind !== "released") unpriced++;
    if (!r.closed) {
      if (r.estimate.currency === currency) reserved += r.estimate.micros;
      else addOther(r.estimate.currency, r.estimate.micros);
      const { closed: _closed, ...view } = r;
      open.push(view);
    } else if (r.closed.kind === "settled") {
      settled++;
      if (r.closed.basis === "estimate") estimated++;
      if (r.closed.cost.currency === currency) spent += r.closed.cost.micros;
      else addOther(r.closed.cost.currency, r.closed.cost.micros);
    } else {
      released++;
    }
  }

  let legacyView = null;
  if (legacy) {
    let micros = 0;
    for (const [cur, amount] of Object.entries(legacy.byCurrency)) {
      if (cur === currency) micros += amount;
      else addOther(cur, amount);
    }
    spent += micros;
    legacyView = { micros, costed: legacy.costed, uncosted: legacy.uncosted };
  }

  const committed = spent + reserved;
  const limit = envelope?.limitMicros ?? null;
  return {
    currency,
    limitMicros: limit,
    warnAtMicros: envelope?.warnAtMicros ?? null,
    spentMicros: spent,
    reservedMicros: reserved,
    committedMicros: committed,
    remainingMicros: limit === null ? null : limit - committed,
    warn: envelope?.warnAtMicros != null && committed >= envelope.warnAtMicros,
    exhausted: limit !== null && committed >= limit,
    counts: { settled, estimated, released, open: open.length, unpriced },
    open,
    legacy: legacyView,
    ...(Object.keys(other).length > 0 ? { otherCurrencies: other } : {}),
  };
}

/**
 * Read and replay an episode's ledger. Strict: a journal line that does not
 * parse might be a reservation, and a budget that silently forgot one would
 * let the next call through.
 */
export async function readBudget(episodeDir, { envelope = null } = {}) {
  const [events, legacy] = await Promise.all([readEvents(episodeDir), readLegacySpend(episodeDir)]);
  return deriveBudget(events, { envelope, legacy });
}

async function readEvents(episodeDir) {
  let text;
  try {
    text = await readFile(path.join(episodeDir, JOURNAL_RELATIVE_PATH), "utf-8");
  } catch (e) {
    if (e?.code === "ENOENT") return [];
    throw e;
  }
  return parseJournal(text, { strict: true });
}

// ── The lock ────────────────────────────────────────────────────────────────

/**
 * The runtime's FileLock, for one resource, from a package that cannot import
 * the runtime. Same file name (base64url of the resource), same JSON, same
 * `wx` arbitration, same refusal to reclaim a lockfile it cannot read — so
 * the two would agree if the runtime ever took this resource itself.
 *
 * Waits briefly instead of refusing at once: ledger writes hold the lock for
 * one read and one append, and two tools reserving a second apart is normal.
 */
async function acquireBudgetLock(episodeDir, now) {
  const dir = path.join(episodeDir, LOCKS_DIR);
  const file = path.join(dir, `${Buffer.from(BUDGET_LOCK_RESOURCE).toString("base64url")}.lock`);
  await mkdir(dir, { recursive: true });
  const deadline = now() + LOCK_WAIT_MS;
  for (;;) {
    const lease = { token: randomUUID(), expiresAt: new Date(now() + LOCK_TTL_MS).toISOString(), resource: BUDGET_LOCK_RESOURCE };
    try {
      await writeFile(file, JSON.stringify(lease), { flag: "wx" });
      return { file, token: lease.token };
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
    }
    let held = null;
    try {
      held = JSON.parse(await readFile(file, "utf-8"));
    } catch (e) {
      if (e?.code === "ENOENT") continue;
    }
    const expires = held && typeof held.token === "string" ? new Date(held.expiresAt).getTime() : NaN;
    if (!Number.isNaN(expires) && expires <= now()) {
      await unlink(file).catch(() => undefined);
      continue;
    }
    // Unreadable is what a writer between its `wx` create and its write
    // looks like, as well as what a crash mid-write leaves. Never reclaimed
    // (its holder may be running), but waited on like a held lock — only at
    // the deadline does it become a refusal.
    if (now() >= deadline) {
      throw new Error(Number.isNaN(expires)
        ? `The episode's budget lock (${file}) is unreadable and cannot be verified as free`
        : `The episode's budget is locked by another writer until ${held.expiresAt}`);
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
}

async function releaseBudgetLock(lock) {
  try {
    const held = JSON.parse(await readFile(lock.file, "utf-8"));
    if (held?.token === lock.token) await unlink(lock.file);
  } catch { /* gone, or reclaimed after expiry: not ours to delete */ }
}

async function underBudgetLock(episodeDir, now, fn) {
  const lock = await acquireBudgetLock(episodeDir, now);
  try {
    return await fn();
  } finally {
    await releaseBudgetLock(lock);
  }
}

// ── Writing ─────────────────────────────────────────────────────────────────

const refuse = (code, reason) => ({ ok: false, code, reason });

/**
 * Reserve an estimate against the budget, or refuse.
 *
 * Refused, with the figures: an estimate that is not integer micros; with a
 * limit set, an estimate in another currency, a model with no known price
 * (nothing to check against the cap), or an estimate that would take the
 * committed total past the limit. With no limit, every well-formed estimate
 * is reserved — the spend is recorded, not capped.
 *
 * Returns `{ ok: true, reserveId }`, or `{ ok: false, code, reason }`. A
 * lock that cannot be taken is a refusal too: failing closed here costs a
 * retry, failing open costs money.
 */
export async function reserveSpend(episodeDir, input) {
  const {
    episode, actor = "pi", capability, provider, profile, purpose,
    estimate, priced = true, envelope = null, now = () => Date.now(),
  } = input;
  if (!isMoney(estimate)) {
    return refuse("BUDGET_INVALID", `An estimate must be integer micros with an ISO currency, not ${JSON.stringify(estimate)}`);
  }
  if (typeof capability !== "string" || !capability || typeof provider !== "string" || !provider) {
    return refuse("BUDGET_INVALID", "A reservation must name its capability and provider");
  }
  if (envelope) {
    if (estimate.currency !== envelope.currency) {
      return refuse("BUDGET_CURRENCY",
        `The budget is in ${envelope.currency} and this call is priced in ${estimate.currency}; ` +
        "they cannot be compared, so it was not reserved");
    }
    if (!priced) {
      return refuse("BUDGET_UNPRICED",
        `No price is known for ${profile ?? provider}, so it cannot be checked against this episode's ` +
        `${formatMoney(envelope.limitMicros, envelope.currency)} budget`);
    }
  }

  try {
    return await underBudgetLock(episodeDir, now, async () => {
      const budget = await readBudget(episodeDir, { envelope });
      if (envelope && budget.committedMicros + estimate.micros > envelope.limitMicros) {
        const cur = envelope.currency;
        return refuse("BUDGET_EXCEEDED",
          `This call (about ${formatMoney(estimate.micros, cur)}) would take the episode past its ` +
          `${formatMoney(envelope.limitMicros, cur)} budget: ${formatMoney(budget.spentMicros, cur)} spent, ` +
          `${formatMoney(budget.reservedMicros, cur)} reserved by calls still open. ` +
          "Raise budget.limitMicros in settings.yaml to continue");
      }
      const reserveId = newReserveId(now());
      const written = await appendJournalEvent(episodeDir, {
        type: "spend-reserved", actor, episode,
        data: {
          reserveId, capability, provider,
          ...(profile ? { profile } : {}),
          ...(purpose ? { purpose } : {}),
          estimate,
          ...(priced ? {} : { priced: false }),
        },
      });
      if (!written) return refuse("BUDGET_UNRECORDED", "The reservation could not be written to the journal, so the call was not made");
      return { ok: true, reserveId };
    });
  } catch (e) {
    return refuse("BUDGET_UNAVAILABLE", e instanceof Error ? e.message : String(e));
  }
}

async function close(episodeDir, type, input, data) {
  const { episode, actor = "pi", reserveId, now = () => Date.now() } = input;
  if (typeof reserveId !== "string" || !RESERVE_ID.test(reserveId)) {
    return refuse("BUDGET_INVALID", `"${reserveId}" is not a reservation id`);
  }
  try {
    return await underBudgetLock(episodeDir, now, async () => {
      const budget = await readBudget(episodeDir);
      if (!budget.open.some((r) => r.reserveId === reserveId)) {
        const events = await readEvents(episodeDir);
        const known = events.some((e) => e.type === "spend-reserved" && e.data?.reserveId === reserveId);
        return refuse("BUDGET_NOT_OPEN", known
          ? `Reservation ${reserveId} is already settled or released`
          : `There is no reservation ${reserveId} in this episode`);
      }
      const written = await appendJournalEvent(episodeDir, { type, actor, episode, data: { reserveId, ...data } });
      return written ? { ok: true } : refuse("BUDGET_UNRECORDED", `The ${type} record could not be written to the journal`);
    });
  } catch (e) {
    return refuse("BUDGET_UNAVAILABLE", e instanceof Error ? e.message : String(e));
  }
}

/** Record what an open reservation actually cost. */
export async function settleSpend(episodeDir, input) {
  const { cost, basis, providerRequestId } = input;
  if (!isMoney(cost)) return refuse("BUDGET_INVALID", `A cost must be integer micros with an ISO currency, not ${JSON.stringify(cost)}`);
  if (basis !== "provider" && basis !== "estimate") return refuse("BUDGET_INVALID", `basis must be "provider" or "estimate", not "${basis}"`);
  return close(episodeDir, "spend-settled", input, { cost, basis, ...(providerRequestId ? { providerRequestId } : {}) });
}

/** Record that an open reservation spent nothing. */
export async function releaseSpend(episodeDir, input) {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) return refuse("BUDGET_INVALID", "A release must say why nothing was spent");
  return close(episodeDir, "spend-released", input, { reason });
}

/** Thrown by `withSpend` when the reservation is refused; the provider was never called. */
export class SpendRefused extends Error {
  constructor(reason, code) {
    super(reason);
    this.name = "SpendRefused";
    this.code = code;
  }
}

/**
 * Reserve, perform, settle — the shape every paid call takes.
 *
 * `perform(call)` does the work and reports how far it got:
 *
 * - `call.sending()` just before the request leaves. Until then a failure
 *   spent nothing and the reservation is released.
 * - `call.refused()` when the provider answered with a refusal (an error
 *   status): it did no work, so the reservation is released.
 *
 * A throw after `sending()` and without `refused()` — a dropped connection,
 * a failed download of a finished result — settles at the estimate: the
 * provider may well have done, and billed, the work.
 *
 * `perform` returns `{ value, cost?, providerRequestId? }`. A `cost` (Money)
 * is what the provider said it charged; without one the estimate stands, and
 * the settlement says so.
 *
 * A settlement or release that cannot be written does not fail the call —
 * the work happened and its output is on disk — but the reservation stays
 * open, so the budget keeps counting it. `onLedgerError` hears about it.
 */
export async function withSpend(episodeDir, reservation, perform, { onLedgerError } = {}) {
  const reserved = await reserveSpend(episodeDir, reservation);
  if (!reserved.ok) throw new SpendRefused(reserved.reason, reserved.code);
  const base = { episode: reservation.episode, actor: reservation.actor, reserveId: reserved.reserveId, now: reservation.now };
  const report = (result) => {
    if (!result.ok) onLedgerError?.(new Error(`${reserved.reserveId}: ${result.reason}`));
  };

  let phase = "before";
  const call = {
    reserveId: reserved.reserveId,
    sending: () => { phase = "sent"; },
    refused: () => { phase = "refused"; },
  };

  let out;
  try {
    out = await perform(call);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (phase === "sent") {
      report(await settleSpend(episodeDir, { ...base, cost: reservation.estimate, basis: "estimate" }));
    } else {
      report(await releaseSpend(episodeDir, {
        ...base,
        reason: phase === "refused" ? `the provider refused the call: ${message}` : `failed before the call was sent: ${message}`,
      }));
    }
    throw e;
  }

  const cost = isMoney(out?.cost) ? out.cost : null;
  report(await settleSpend(episodeDir, {
    ...base,
    cost: cost ?? reservation.estimate,
    basis: cost ? "provider" : "estimate",
    ...(out?.providerRequestId ? { providerRequestId: out.providerRequestId } : {}),
  }));
  return out?.value;
}
