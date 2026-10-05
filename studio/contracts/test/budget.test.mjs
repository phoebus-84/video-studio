import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  deriveBudget, envelopeFromSettings, resolveBudgetEnvelope, readLegacySpend, readBudget,
  reserveSpend, settleSpend, releaseSpend, withSpend, SpendRefused, toMicros, formatMoney, newReserveId,
} from "../src/budget.mjs";
import { JOURNAL_RELATIVE_PATH, parseJournal } from "../src/journal.mjs";

const REF = { channel: "chan", series: "ser", episode: "ep1" };
const USD = (micros) => ({ currency: "USD", micros });
const LIMIT = (limitMicros, warnAtMicros = null) => ({ currency: "USD", limitMicros, warnAtMicros });

let seq = 0;
const ev = (type, data) => ({ type, at: `2026-10-02T10:00:${String(seq++ % 60).padStart(2, "0")}.000Z`, actor: "pi", data });
const reserved = (id, micros, extra = {}) =>
  ev("spend-reserved", { reserveId: id, capability: "image.generate", provider: "fal", estimate: USD(micros), ...extra });
const settled = (id, micros, basis = "estimate") => ev("spend-settled", { reserveId: id, cost: USD(micros), basis });
const released = (id) => ev("spend-released", { reserveId: id, reason: "refused" });

const R1 = newReserveId(1);
const R2 = newReserveId(2);
const R3 = newReserveId(3);

describe("money", () => {
  it("converts provider prices to integer micros without float drift", () => {
    assert.equal(toMicros(0.003), 3000);
    assert.equal(toMicros(0.48), 480_000);
    assert.throws(() => toMicros(-1), /non-negative/);
    assert.throws(() => toMicros(Number.NaN), /non-negative/);
  });
  it("prints figures a person can read", () => {
    assert.equal(formatMoney(5_000_000, "USD"), "$5.00");
    assert.equal(formatMoney(25_000, "USD"), "$0.025");
    assert.equal(formatMoney(1_500_000, "EUR"), "1.50 EUR");
  });
});

describe("envelopeFromSettings", () => {
  it("reads a top-level budget", () => {
    assert.deepEqual(envelopeFromSettings({ budget: { currency: "EUR", limitMicros: 2_000_000, warnAtMicros: 1_500_000 } }),
      { currency: "EUR", limitMicros: 2_000_000, warnAtMicros: 1_500_000 });
  });
  it("invents nothing for an absent or unreadable one", () => {
    assert.equal(envelopeFromSettings({}), null);
    assert.equal(envelopeFromSettings(null), null);
    assert.equal(envelopeFromSettings({ budget: { limitMicros: "lots" } }), null);
    assert.equal(envelopeFromSettings({ budget: { limitMicros: 1.5 } }), null);
  });
});

describe("deriveBudget", () => {
  it("counts settled costs as spent and open reservations as reserved", () => {
    const state = deriveBudget([reserved(R1, 100), settled(R1, 90, "provider"), reserved(R2, 50)], { envelope: LIMIT(1000) });
    assert.equal(state.spentMicros, 90);
    assert.equal(state.reservedMicros, 50);
    assert.equal(state.committedMicros, 140);
    assert.equal(state.remainingMicros, 860);
    assert.deepEqual(state.open.map((r) => r.reserveId), [R2]);
    assert.deepEqual(state.counts, { settled: 1, estimated: 0, released: 0, open: 1, unpriced: 0 });
  });

  it("frees a released reservation entirely", () => {
    const state = deriveBudget([reserved(R1, 100), released(R1)], { envelope: LIMIT(1000) });
    assert.equal(state.committedMicros, 0);
    assert.equal(state.counts.released, 1);
  });

  it("counts a reservation once, whichever closing record comes first", () => {
    const state = deriveBudget([reserved(R1, 100), settled(R1, 100), settled(R1, 100), released(R1)]);
    assert.equal(state.spentMicros, 100);
    assert.equal(state.counts.settled, 1);
    assert.equal(state.counts.released, 0);
  });

  it("ignores a settlement for a reservation it never saw", () => {
    assert.equal(deriveBudget([settled(R3, 500)]).spentMicros, 0);
  });

  it("reports exhaustion and the warning threshold against committed spend", () => {
    const state = deriveBudget([reserved(R1, 800), reserved(R2, 200)], { envelope: LIMIT(1000, 900) });
    assert.equal(state.warn, true);
    assert.equal(state.exhausted, true);
    assert.equal(state.remainingMicros, 0);
  });

  it("has no limit, and no remaining, when no budget is configured", () => {
    const state = deriveBudget([reserved(R1, 100), settled(R1, 100)]);
    assert.equal(state.limitMicros, null);
    assert.equal(state.remainingMicros, null);
    assert.equal(state.exhausted, false);
    assert.equal(state.currency, "USD");
  });

  it("never sums another currency into the budget's", () => {
    const state = deriveBudget([
      reserved(R1, 100),
      ev("spend-reserved", { reserveId: R2, capability: "image.generate", provider: "x", estimate: { currency: "EUR", micros: 70 } }),
    ], { envelope: LIMIT(1000) });
    assert.equal(state.reservedMicros, 100);
    assert.deepEqual(state.otherCurrencies, { EUR: 70 });
  });

  it("adds what older productions recorded, and says so", () => {
    const state = deriveBudget([], { envelope: LIMIT(1000), legacy: { byCurrency: { USD: 300 }, costed: 2, uncosted: 1 } });
    assert.equal(state.spentMicros, 300);
    assert.deepEqual(state.legacy, { micros: 300, costed: 2, uncosted: 1 });
  });

  it("counts calls made without a known price", () => {
    const state = deriveBudget([reserved(R1, 0, { priced: false }), settled(R1, 0)]);
    assert.equal(state.counts.unpriced, 1);
  });
});

describe("on disk", () => {
  let root;
  let dir;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "budget-"));
    dir = path.join(root, "chan", "series", "ser", "episodes", "ep1");
    await mkdir(path.join(dir, "journal"), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const journal = async () =>
    parseJournal(await readFile(path.join(dir, JOURNAL_RELATIVE_PATH), "utf-8").catch(() => ""));
  const reserve = (micros, extra = {}) => reserveSpend(dir, {
    episode: REF, capability: "image.generate", provider: "fal", profile: "fal-ai/flux/dev@v1",
    estimate: USD(micros), envelope: LIMIT(1000), ...extra,
  });

  it("resolves the nearest settings.yaml that declares a budget", async () => {
    const parse = (text) => JSON.parse(text);
    await mkdir(path.join(root, "chan", "series", "ser"), { recursive: true });
    await writeFile(path.join(root, "chan", "settings.yaml"), JSON.stringify({ budget: { currency: "USD", limitMicros: 9 } }));
    await writeFile(path.join(root, "chan", "series", "ser", "settings.yaml"), JSON.stringify({ budget: { currency: "USD", limitMicros: 5 } }));
    await writeFile(path.join(dir, "settings.yaml"), "{}");
    const { envelope, from } = await resolveBudgetEnvelope(root, REF, parse);
    assert.equal(from, "series");
    assert.equal(envelope.limitMicros, 5);
  });

  it("reserves under the limit and writes the reservation to the journal", async () => {
    const result = await reserve(400, { purpose: "image s1" });
    assert.equal(result.ok, true);
    const [event] = await journal();
    assert.equal(event.type, "spend-reserved");
    assert.equal(event.data.reserveId, result.reserveId);
    assert.equal(event.data.purpose, "image s1");
  });

  it("refuses a call that would pass the limit, naming the figures", async () => {
    assert.equal((await reserve(700)).ok, true);
    const refused = await reserve(400);
    assert.equal(refused.ok, false);
    assert.equal(refused.code, "BUDGET_EXCEEDED");
    assert.match(refused.reason, /\$0\.001 budget/);
    assert.match(refused.reason, /\$0\.0007 reserved/);
    assert.equal((await journal()).length, 1);
  });

  it("lets two concurrent reservations take the last of the budget only once", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => reserve(300)));
    assert.equal(results.filter((r) => r.ok).length, 3);
    assert.equal((await readBudget(dir, { envelope: LIMIT(1000) })).reservedMicros, 900);
    assert.deepEqual(await readdir(path.join(dir, ".locks")), []);
  });

  it("refuses an unpriced call against a limit, and records one without", async () => {
    const capped = await reserve(0, { priced: false });
    assert.equal(capped.code, "BUDGET_UNPRICED");
    const uncapped = await reserve(0, { priced: false, envelope: null });
    assert.equal(uncapped.ok, true);
    assert.equal((await journal())[0].data.priced, false);
  });

  it("refuses an estimate in another currency than the budget's", async () => {
    const result = await reserve(10, { estimate: { currency: "EUR", micros: 10 } });
    assert.equal(result.code, "BUDGET_CURRENCY");
  });

  it("records every call with no budget configured — recorded, not capped", async () => {
    const result = await reserve(5_000_000, { envelope: null });
    assert.equal(result.ok, true);
  });

  it("settles once and refuses a second close", async () => {
    const { reserveId } = await reserve(100);
    assert.equal((await settleSpend(dir, { episode: REF, reserveId, cost: USD(90), basis: "provider" })).ok, true);
    const again = await releaseSpend(dir, { episode: REF, reserveId, reason: "operator" });
    assert.equal(again.code, "BUDGET_NOT_OPEN");
    assert.match(again.reason, /already settled or released/);
  });

  it("refuses to close a reservation that does not exist", async () => {
    const result = await releaseSpend(dir, { episode: REF, reserveId: R3, reason: "operator" });
    assert.match(result.reason, /no reservation/);
  });

  it("fails closed on a journal it cannot read", async () => {
    await writeFile(path.join(dir, JOURNAL_RELATIVE_PATH), "{not json\n");
    const result = await reserve(10);
    assert.equal(result.code, "BUDGET_UNAVAILABLE");
  });

  it("refuses rather than wait for ever on a held lock", async () => {
    await mkdir(path.join(dir, ".locks"), { recursive: true });
    const file = path.join(dir, ".locks", `${Buffer.from("budget").toString("base64url")}.lock`);
    await writeFile(file, JSON.stringify({ token: "t", resource: "budget", expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    let clock = Date.now();
    const result = await reserve(10, { now: () => (clock += 1000) });
    assert.equal(result.code, "BUDGET_UNAVAILABLE");
    assert.match(result.reason, /locked by another writer/);
  });

  it("reclaims an expired lock", async () => {
    await mkdir(path.join(dir, ".locks"), { recursive: true });
    const file = path.join(dir, ".locks", `${Buffer.from("budget").toString("base64url")}.lock`);
    await writeFile(file, JSON.stringify({ token: "t", resource: "budget", expiresAt: new Date(Date.now() - 1).toISOString() }));
    assert.equal((await reserve(10)).ok, true);
  });

  it("reads legacy costs from the asset manifest", async () => {
    await mkdir(path.join(dir, "assets"), { recursive: true });
    await writeFile(path.join(dir, "assets", "manifest.json"), JSON.stringify({
      assets: [{ attempts: [{ cost: USD(400) }, { cost: USD(100) }, {}] }],
    }));
    assert.deepEqual(await readLegacySpend(dir), { byCurrency: { USD: 500 }, costed: 2, uncosted: 1 });
    assert.equal((await reserve(600)).code, "BUDGET_EXCEEDED");
  });

  describe("withSpend", () => {
    const reservation = (micros = 100) => ({
      episode: REF, capability: "image.generate", provider: "fal", estimate: USD(micros), envelope: LIMIT(1000),
    });
    const kinds = async () => (await journal()).map((e) => `${e.type}${e.data.basis ? `:${e.data.basis}` : ""}`);

    it("settles at the provider's figure when it reports one", async () => {
      const value = await withSpend(dir, reservation(), async (call) => {
        call.sending();
        return { value: "png", cost: USD(80), providerRequestId: "req-1" };
      });
      assert.equal(value, "png");
      assert.deepEqual(await kinds(), ["spend-reserved", "spend-settled:provider"]);
      assert.equal((await journal())[1].data.providerRequestId, "req-1");
    });

    it("settles at the estimate when the provider reports nothing", async () => {
      await withSpend(dir, reservation(), async (call) => { call.sending(); return { value: 1 }; });
      assert.deepEqual(await kinds(), ["spend-reserved", "spend-settled:estimate"]);
    });

    it("releases a call that failed before it was sent", async () => {
      await assert.rejects(withSpend(dir, reservation(), async () => { throw new Error("bad input"); }), /bad input/);
      assert.deepEqual(await kinds(), ["spend-reserved", "spend-released"]);
      assert.match((await journal())[1].data.reason, /before the call was sent: bad input/);
    });

    it("releases a call the provider refused", async () => {
      await assert.rejects(withSpend(dir, reservation(), async (call) => {
        call.sending();
        call.refused();
        throw new Error("422");
      }));
      assert.deepEqual(await kinds(), ["spend-reserved", "spend-released"]);
    });

    it("settles at the estimate when it failed after the request left", async () => {
      await assert.rejects(withSpend(dir, reservation(), async (call) => {
        call.sending();
        throw new Error("socket hang up");
      }));
      assert.deepEqual(await kinds(), ["spend-reserved", "spend-settled:estimate"]);
    });

    it("never calls the provider when the reservation is refused", async () => {
      let called = false;
      await assert.rejects(
        withSpend(dir, reservation(5000), async () => { called = true; return { value: 1 }; }),
        (e) => e instanceof SpendRefused && e.code === "BUDGET_EXCEEDED",
      );
      assert.equal(called, false);
      assert.deepEqual(await kinds(), []);
    });
  });
});
