# Authenticated, Revision-Bound Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An approval says who gave it and proves it: human approvals are HMAC-signed with an operator key Pi never holds, bound to the plan and the artifacts, and nothing an agent can do satisfies a human gate.

**Architecture:** Signing and verification live in `@studio/contracts` (`receipt.mjs`, `operator-key.mjs`, `gate-review.mjs`). `ExecutionService.review()` in `@studio/runtime` is the only writer of review events and derives the receipt's origin from a caller-supplied `Principal`. The gateway resolves the principal from which credential a request carries; the CLI from whether it can read the operator key file. A runtime `JournalReviewGate` verifies receipts and maps them onto the manifest's review level.

**Tech Stack:** Node ≥ 20 ESM (`.mjs` + `.d.mts` in contracts, `node --test`), TypeScript + vitest (runtime, gateway, agent), Fastify (gateway), Svelte 5 + vitest via bun (web), `node:crypto` HMAC-SHA256.

**Spec:** `docs/superpowers/specs/2026-09-24-authenticated-revision-bound-approval-design.md`

## Global Constraints

- The journal stays the only store. No approval state lives anywhere else.
- Every failure fails closed with a reason a person can read. Nothing counts as approved on a write that did not land.
- `origin` is who *decided* (`human | agent | policy`); journal `actor` is who *wrote the line*. The service writes review events with `actor: "runtime"`.
- `signature` is present exactly when `origin: "human"` and the decision is `approved` or `rejected`. A request is never signed.
- `dev-token` is never an `operator`.
- Pi must never be given, pointed at, or able to discover through its config the operator key file.
- Default principal when a caller supplies none: `agent`. Omission never grants.
- Operator key and gateway token files: mode 0600. Group- or world-readable refuses (gateway start, CLI command).
- Match the surrounding comment style: comments explain *why*, name the defect they prevent, and cite the issue id.
- Commit after every task. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work on a branch: `git checkout -b qr4.3-authenticated-approval` before Task 1.

**Test commands** (run from repo root):
- contracts: `cd studio/contracts && npm test` (and `npm run check:schemas` when a schema or fixture changes)
- runtime: `cd studio/runtime && npx vitest run <path>` (whole suite: `npm test`, which builds first)
- gateway: `cd studio/gateway && npx vitest run <path>`
- agent: `cd studio/agent && npx vitest run <path>`
- web: `cd studio/web && bun x vitest run <path>`
- everything: `npm run check` at the root, before the final commit

---

## File Structure

| File | Responsibility |
|---|---|
| `studio/contracts/src/receipt.mjs` (+`.d.mts`) | **new** — canonical JSON, `planHashOf`, `signReceipt`, `verifyReceipt` |
| `studio/contracts/src/operator-key.mjs` (+`.d.mts`) | **new** — read the operator key file, enforce 0600 |
| `studio/contracts/src/gate-review.mjs` (+`.d.mts`) | review record v2: `origin`, `binding`, `signature`, `rejected`; `deriveGateState` verification |
| `studio/contracts/src/journal.mjs` (+`.d.mts`) | `approval-rejected` event type |
| `studio/contracts/schemas/v1alpha1/gate-review.schema.json` | record v2 |
| `studio/contracts/schemas/v1alpha1/journal-event.schema.json` | `approval-rejected` in the type enum |
| `studio/contracts/schemas/v1alpha1/execution-event.schema.json` | optional `attended` on `StageLeased` |
| `studio/contracts/fixtures/gate-review/**` | v2 fixtures |
| `studio/runtime/src/execution/types.ts` | `Principal`, `ReviewInput`, outcome/state additions, `operatorKey` option, port arg |
| `studio/runtime/src/execution/service.ts` | `review()`, attended claims, request-on-completion, staleness, status |
| `studio/runtime/src/execution/journal-review-gate.ts` | **new** — verifies receipts, maps origin to review level |
| `studio/runtime/src/execution/principal.ts` | **new** — CLI principal from the key file |
| `studio/runtime/src/cli.ts` | `approve`/`reject` via the service; principal on `run`; rerun guard removed |
| `studio/gateway/src/auth/middleware.ts` | principal per credential |
| `studio/gateway/src/auth/token.ts` | `resolveOperatorKey` |
| `studio/gateway/src/config/schema.ts` | `operatorKey.file` |
| `studio/gateway/src/server.ts` | resolve the key, pass it to middleware, WS and routes |
| `studio/gateway/src/events/bus.ts` | WS accepts either credential |
| `studio/gateway/src/runtime/service.ts` | inject `JournalReviewGate` + `operatorKey` |
| `studio/gateway/src/runtime/review-gate.ts` | **deleted** (moved to runtime) |
| `studio/gateway/src/runtime/client.ts` | `approve()` deleted |
| `studio/gateway/src/routes/production.ts` | `/approve`, `/reject`, principal on execute/claim |
| `studio/gateway/src/rpc/intent-router.ts` | `approve` intent refuses |
| `studio/agent/src/pipeline-tools.ts`, `slash-commands.ts` | `pva_request_approval` |
| `studio/web/vite.config.ts`, `src/lib/gateway.svelte.ts`, `src/lib/production-store.svelte.ts`, `src/contracts/gateway.ts`, `src/components/episode/*` | operator credential, reject, `stale` |

---

### Task 1: Receipt signing and the operator key file (contracts)

**Files:**
- Create: `studio/contracts/src/receipt.mjs`, `studio/contracts/src/receipt.d.mts`
- Create: `studio/contracts/src/operator-key.mjs`, `studio/contracts/src/operator-key.d.mts`
- Test: `studio/contracts/test/receipt.test.mjs`, `studio/contracts/test/operator-key.test.mjs`

**Interfaces:**
- Produces:
  - `canonicalJson(value: unknown): string` — sorted object keys at every depth, array order kept, `undefined` members dropped
  - `planHashOf(definition: object): string` — lowercase hex sha256 of `canonicalJson(definition)`
  - `signReceipt<T extends object>(review: T, key: string): T & { signature: string }`
  - `verifyReceipt(review: object, key: string): boolean`
  - `SIGNED_FIELDS = ["stageId", "decision", "origin", "binding", "at"]`
  - `OPERATOR_KEY_ENV = "AVG_OPERATOR_KEY_FILE"`
  - `readOperatorKey(file: string): string | null` — `null` when absent; throws on loose permissions or an empty file

- [ ] **Step 1: Write the failing receipt tests**

`studio/contracts/test/receipt.test.mjs`:

```js
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { canonicalJson, planHashOf, signReceipt, verifyReceipt, SIGNED_FIELDS } from "../src/receipt.mjs";

const KEY = "k".repeat(43);
const review = () => ({
  stageId: "script",
  decision: "approved",
  origin: "human",
  actor: "runtime",
  at: "2026-09-24T10:00:00.000Z",
  binding: { planHash: "a".repeat(64), inputs: [], outputs: [{ path: "artifacts/script.md", sha256: "b".repeat(64) }] },
  checks: [],
});

describe("canonicalJson", () => {
  it("does not depend on key order", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it("keeps array order, because order in a list means something", () => {
    assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  });
  it("drops undefined members the way JSON.stringify does", () => {
    assert.equal(canonicalJson({ a: 1, b: undefined }), canonicalJson({ a: 1 }));
  });
});

describe("planHashOf", () => {
  it("is the sha256 of the canonical JSON", () => {
    const def = { id: "script", gates: { review: "human", autopilot: false } };
    assert.equal(planHashOf(def), createHash("sha256").update(canonicalJson(def)).digest("hex"));
  });
  it("changes when the definition changes", () => {
    assert.notEqual(planHashOf({ id: "s", gates: { review: "human" } }), planHashOf({ id: "s", gates: { review: "none" } }));
  });
});

describe("signReceipt / verifyReceipt", () => {
  it("round-trips", () => {
    assert.equal(verifyReceipt(signReceipt(review(), KEY), KEY), true);
  });
  it("signs exactly the decision-bearing fields", () => {
    assert.deepEqual(SIGNED_FIELDS, ["stageId", "decision", "origin", "binding", "at"]);
  });
  it("fails for every signed field that is tampered with", () => {
    const signed = signReceipt(review(), KEY);
    const tampered = [
      { ...signed, stageId: "compose" },
      { ...signed, decision: "rejected" },
      { ...signed, origin: "agent" },
      { ...signed, at: "2026-09-25T10:00:00.000Z" },
      { ...signed, binding: { ...signed.binding, planHash: "c".repeat(64) } },
      { ...signed, binding: { ...signed.binding, outputs: [] } },
    ];
    for (const t of tampered) assert.equal(verifyReceipt(t, KEY), false, JSON.stringify(t));
  });
  it("fails under another key", () => {
    assert.equal(verifyReceipt(signReceipt(review(), KEY), "x".repeat(43)), false);
  });
  it("fails with no signature, or a signature of the wrong length, without throwing", () => {
    assert.equal(verifyReceipt(review(), KEY), false);
    assert.equal(verifyReceipt({ ...review(), signature: "ab" }, KEY), false);
  });
  it("refuses to sign without a key rather than signing with an empty one", () => {
    assert.throws(() => signReceipt(review(), ""), /key/);
  });
});
```

- [ ] **Step 2: Write the failing operator-key tests**

`studio/contracts/test/operator-key.test.mjs`:

```js
import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readOperatorKey, OPERATOR_KEY_ENV } from "../src/operator-key.mjs";

describe("readOperatorKey", () => {
  let dir;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "opkey-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("names the environment variable callers use to point at the file", () => {
    assert.equal(OPERATOR_KEY_ENV, "AVG_OPERATOR_KEY_FILE");
  });
  it("returns null when there is no key file: that is a headless caller, not an error", () => {
    assert.equal(readOperatorKey(path.join(dir, "missing")), null);
  });
  it("reads and trims a 0600 key", async () => {
    const file = path.join(dir, ".operator-key");
    await writeFile(file, "secret\n", { mode: 0o600 });
    assert.equal(readOperatorKey(file), "secret");
  });
  it("refuses a key other users can read", async () => {
    const file = path.join(dir, ".operator-key");
    await writeFile(file, "secret");
    await chmod(file, 0o644);
    assert.throws(() => readOperatorKey(file), /0600|permissions/);
  });
  it("refuses an empty key rather than signing with nothing", async () => {
    const file = path.join(dir, ".operator-key");
    await writeFile(file, "  \n", { mode: 0o600 });
    assert.throws(() => readOperatorKey(file), /empty/);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `cd studio/contracts && node --test test/receipt.test.mjs test/operator-key.test.mjs`
Expected: FAIL — `Cannot find module '../src/receipt.mjs'`.

- [ ] **Step 4: Implement `receipt.mjs`**

```js
// ---------------------------------------------------------------------------
// Review receipts
// ---------------------------------------------------------------------------
// A journal line is plain JSONL, and anything running as the operator's user
// can append one. avg-qr4.3: a human approval has to carry proof of where it
// came from, or the review gate cannot tell a person's decision from a line an
// agent wrote with its file tools. The proof is an HMAC keyed by the operator
// key — a file the browser and CLI hold and Pi is never given.
//
// What this does NOT defend against: a same-user process that deliberately
// reads the key file. That boundary is avg-qr4.8's OS isolation.
// ---------------------------------------------------------------------------

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** The fields a signature covers: everything that says what was decided about what. */
export const SIGNED_FIELDS = Object.freeze(["stageId", "decision", "origin", "binding", "at"]);

/** JSON with object keys sorted at every depth, so equal values hash equally. */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = sortKeys(value[key]);
    }
    return out;
  }
  return value;
}

/** Hash of a stage's resolved definition: what the approval was an approval OF. */
export function planHashOf(definition) {
  return createHash("sha256").update(canonicalJson(definition)).digest("hex");
}

function mac(review, key) {
  const body = {};
  for (const field of SIGNED_FIELDS) body[field] = review[field];
  return createHmac("sha256", key).update(canonicalJson(body)).digest("hex");
}

export function signReceipt(review, key) {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("Cannot sign a receipt without an operator key");
  }
  return { ...review, signature: mac(review, key) };
}

export function verifyReceipt(review, key) {
  if (typeof review?.signature !== "string" || typeof key !== "string" || key.length === 0) return false;
  const expected = Buffer.from(mac(review, key), "hex");
  const actual = Buffer.from(review.signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

`receipt.d.mts`:

```ts
export declare const SIGNED_FIELDS: readonly ["stageId", "decision", "origin", "binding", "at"];
export declare function canonicalJson(value: unknown): string;
export declare function planHashOf(definition: object): string;
export declare function signReceipt<T extends object>(review: T, key: string): T & { signature: string };
export declare function verifyReceipt(review: object, key: string): boolean;
```

- [ ] **Step 5: Implement `operator-key.mjs`**

```js
// ---------------------------------------------------------------------------
// The operator key
// ---------------------------------------------------------------------------
// Whoever can read this file is the operator (avg-qr4.3). The gateway
// generates it next to its bearer token; the CLI reads it; Pi is handed the
// agent token only. Absence is a headless caller, not an error — the caller
// may still REQUEST approval. A key other users can read is refused outright,
// the same rule the gateway applies to its token.
// ---------------------------------------------------------------------------

import { readFileSync, statSync } from "node:fs";

export const OPERATOR_KEY_ENV = "AVG_OPERATOR_KEY_FILE";

export function readOperatorKey(file) {
  let info;
  try {
    info = statSync(file);
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error(
      `Operator key "${file}" is readable by other users (mode ${(info.mode & 0o777).toString(8)}); ` +
      `it must be 0600. Run: chmod 600 "${file}"`,
    );
  }
  const key = readFileSync(file, "utf-8").trim();
  if (!key) throw new Error(`Operator key "${file}" is empty. Delete it and restart the gateway to regenerate it.`);
  return key;
}
```

`operator-key.d.mts`:

```ts
export declare const OPERATOR_KEY_ENV: "AVG_OPERATOR_KEY_FILE";
export declare function readOperatorKey(file: string): string | null;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd studio/contracts && node --test test/receipt.test.mjs test/operator-key.test.mjs`
Expected: PASS, all tests.

- [ ] **Step 7: Commit**

```bash
git add studio/contracts/src/receipt.* studio/contracts/src/operator-key.* studio/contracts/test/receipt.test.mjs studio/contracts/test/operator-key.test.mjs
git commit -m "feat(contracts): sign review receipts with the operator key"
```

---

### Task 2: Review record v2 — origin, binding, rejection (contracts, no enforcement yet)

This task changes the record's shape and teaches the gate to read `rejected`. Signature and plan-hash **enforcement** is Task 6; until then a human grant is read exactly as today (hash comparison only), so every existing caller stays green.

**Files:**
- Modify: `studio/contracts/src/gate-review.mjs`, `gate-review.d.mts`
- Modify: `studio/contracts/src/journal.mjs:61-75` (`JOURNAL_EVENTS`), `journal.d.mts:13-17`
- Modify: `studio/contracts/schemas/v1alpha1/gate-review.schema.json`, `journal-event.schema.json` (type enum)
- Modify: `studio/contracts/fixtures/gate-review/valid/*.json`; create `valid/rejected.json`, `invalid/human-approved-unsigned.json`, `invalid/rejected-without-note.json`
- Modify: `studio/contracts/scripts/check-gate-review-fixtures.mjs` (fixture lists)
- Modify callers: `studio/runtime/src/cli.ts:590-597` (`cmdApprove`'s `buildGateReview` call), `studio/gateway/test/gate-enforcement.test.ts` (its `buildGateReview` calls)
- Test: `studio/contracts/test/gate-review.test.mjs`, `studio/contracts/test/journal.test.mjs`

**Interfaces:**
- Produces:
  - `GATE_DECISIONS = ["requested", "approved", "rejected"]`
  - `REVIEW_ORIGINS = ["human", "agent", "policy"]`
  - `REVIEW_EVENT_FOR = { requested: "approval-requested", approved: "approval-granted", rejected: "approval-rejected" }`
  - `buildGateReview({ stageId, decision, origin, actor, binding: { planHash, inputs?, outputs? }, checks?, note?, at? })` → `{ stageId, decision, origin, actor, at, binding: { planHash, inputs, outputs }, checks, note? }`
  - `deriveGateState(events, stageId, episodeDir, opts?)` → `{ state: "none" } | { state: "requested", at, origin } | { state: "rejected", at, origin, note } | { state: "invalidated", reason } | { state: "approved", at, origin }`
  - `"approval-rejected"` in `JOURNAL_EVENTS`

- [ ] **Step 1: Write the failing tests**

Replace the `buildGateReview` and `deriveGateState` describe blocks in `studio/contracts/test/gate-review.test.mjs` (keep `hashArtifacts`). Key cases:

```js
describe("buildGateReview", () => {
  const hash = "a".repeat(64);
  const binding = { planHash: "p".repeat(64), outputs: [{ path: "artifacts/x.md", sha256: hash }] };

  it("carries origin and binding, with inputs defaulted", () => {
    const r = buildGateReview({ stageId: "s", decision: "approved", origin: "agent", actor: "runtime", binding });
    assert.equal(r.origin, "agent");
    assert.deepEqual(r.binding.inputs, []);
    assert.equal(r.binding.planHash, "p".repeat(64));
  });
  it("refuses an unknown origin", () => {
    assert.throws(() => buildGateReview({ stageId: "s", decision: "approved", origin: "robot", actor: "runtime", binding }), /origin/);
  });
  it("refuses an approval with no planHash: it could not be invalidated by a changed plan", () => {
    assert.throws(() => buildGateReview({ stageId: "s", decision: "approved", origin: "agent", actor: "runtime",
      binding: { outputs: binding.outputs } }), /planHash/);
  });
  it("refuses an approval that names no outputs", () => {
    assert.throws(() => buildGateReview({ stageId: "s", decision: "approved", origin: "agent", actor: "runtime",
      binding: { planHash: "p".repeat(64), outputs: [] } }), /at least one output/);
  });
  it("accepts a rejection, and requires it to say why", () => {
    assert.throws(() => buildGateReview({ stageId: "s", decision: "rejected", origin: "agent", actor: "runtime", binding }), /note/);
    const r = buildGateReview({ stageId: "s", decision: "rejected", origin: "agent", actor: "runtime", binding, note: "too dark" });
    assert.equal(r.decision, "rejected");
  });
  it("lists three decisions", () => {
    assert.deepEqual([...GATE_DECISIONS], ["requested", "approved", "rejected"]);
  });
});

describe("deriveGateState", () => {
  // helper: write artifacts/x.md, hash it, and build events of each type
  it("reads the latest of requested, granted and rejected", async () => {
    await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
    const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
    const binding = { planHash: "p".repeat(64), outputs };
    const ev = (type, decision, extra = {}) => ({ type, at: "2026-09-24T00:00:00Z", actor: "runtime",
      data: buildGateReview({ stageId: "s", decision, origin: "agent", actor: "runtime", binding, ...extra }) });

    assert.equal((await deriveGateState([ev("approval-requested", "requested")], "s", dir)).state, "requested");
    assert.equal((await deriveGateState([ev("approval-granted", "approved")], "s", dir)).state, "approved");
    const rejected = await deriveGateState(
      [ev("approval-granted", "approved"), ev("approval-rejected", "rejected", { note: "too dark" })], "s", dir);
    assert.equal(rejected.state, "rejected");
    assert.equal(rejected.note, "too dark");
  });
  it("still invalidates a grant whose artifact changed", async () => {
    await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
    const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
    const data = buildGateReview({ stageId: "s", decision: "approved", origin: "agent", actor: "runtime",
      binding: { planHash: "p".repeat(64), outputs } });
    await writeFile(path.join(dir, "artifacts", "x.md"), "v2");
    const state = await deriveGateState([{ type: "approval-granted", data }], "s", dir);
    assert.equal(state.state, "invalidated");
    assert.match(state.reason, /changed since it was approved/);
  });
  it("reads a pre-v2 record's top-level inputs/outputs, so existing journals still parse", async () => {
    await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
    const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
    const legacy = { type: "approval-granted", actor: "human",
      data: { stageId: "s", decision: "approved", actor: "human", at: "t", inputs: [], outputs, checks: [] } };
    assert.equal((await deriveGateState([legacy], "s", dir)).state, "approved");
  });
});
```

In `studio/contracts/test/journal.test.mjs` add:

```js
it("accepts approval-rejected as an event type", () => {
  const e = buildJournalEvent({ type: "approval-rejected", actor: "runtime",
    episode: { channel: "c", series: "s", episode: "e" }, data: { stageId: "x" } });
  assert.equal(e.type, "approval-rejected");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd studio/contracts && node --test test/gate-review.test.mjs test/journal.test.mjs`
Expected: FAIL — `origin` unknown, `approval-rejected` unknown event type.

- [ ] **Step 3: Implement**

In `journal.mjs` add `"approval-rejected"` after `"approval-requested"` in `JOURNAL_EVENTS`; add it to the union in `journal.d.mts` and the type enum in `journal-event.schema.json`.

In `gate-review.mjs`, replace `GATE_DECISIONS`' comment and value, and `buildGateReview`:

```js
/**
 * Decisions a record may carry. `rejected` rides in its own event type,
 * approval-rejected (avg-qr4.3), so no event on disk contradicts itself.
 */
export const GATE_DECISIONS = Object.freeze(["requested", "approved", "rejected"]);

/**
 * Who decided — as distinct from the journal `actor`, who wrote the line. The
 * gateway writes a human's decision; a reader needs both answers.
 */
export const REVIEW_ORIGINS = Object.freeze(["human", "agent", "policy"]);

export const REVIEW_EVENT_FOR = Object.freeze({
  requested: "approval-requested",
  approved: "approval-granted",
  rejected: "approval-rejected",
});

export function buildGateReview({ stageId, decision, origin, actor, binding, checks = [], note, at }) {
  if (!stageId) throw new Error("A gate review must name its stage");
  if (!GATE_DECISIONS.includes(decision)) {
    throw new Error(`Unknown gate review decision: ${decision} (expected ${GATE_DECISIONS.join(", ")})`);
  }
  if (!REVIEW_ORIGINS.includes(origin)) {
    throw new Error(`Unknown gate review origin: ${origin} (expected ${REVIEW_ORIGINS.join(", ")})`);
  }
  if (!JOURNAL_ACTORS.includes(actor)) throw new Error(`Unknown gate review actor: ${actor}`);

  const inputs = binding?.inputs ?? [];
  const outputs = binding?.outputs ?? [];
  if (decision !== "requested" && !binding?.planHash) {
    throw new Error(
      `Stage "${stageId}" cannot be ${decision} without a planHash: ` +
      `a decision that names no plan cannot be invalidated by the plan changing`,
    );
  }
  if (decision === "approved" && outputs.length === 0) {
    throw new Error(
      `Stage "${stageId}" cannot be approved without naming at least one output: ` +
      `an approval of nothing cannot be invalidated by anything`,
    );
  }
  if (decision === "rejected" && !note) {
    throw new Error(`Stage "${stageId}" cannot be rejected without a note: a rejection nobody can act on is noise`);
  }

  const review = {
    stageId, decision, origin, actor,
    at: at ?? new Date().toISOString(),
    binding: { planHash: binding?.planHash, inputs, outputs },
    checks,
  };
  if (review.binding.planHash === undefined) delete review.binding.planHash;
  if (note !== undefined) review.note = note;
  return review;
}
```

Replace `deriveGateState`:

```js
const REVIEW_EVENTS = new Set(Object.values(REVIEW_EVENT_FOR));

/** A record's binding, reading pre-v2 records' top-level inputs/outputs. */
function bindingOf(data) {
  return data?.binding ?? { inputs: data?.inputs ?? [], outputs: data?.outputs ?? [] };
}

export async function deriveGateState(events, stageId, episodeDir, opts = {}) {
  const latest = [...events].reverse()
    .find((event) => REVIEW_EVENTS.has(event.type) && event.data?.stageId === stageId);
  if (!latest) return { state: "none" };

  const origin = latest.data?.origin ?? (latest.actor === "human" ? "human" : "agent");
  if (latest.type === "approval-requested") return { state: "requested", at: latest.at, origin };
  if (latest.type === "approval-rejected") {
    return { state: "rejected", at: latest.at, origin, note: latest.data?.note };
  }

  const binding = bindingOf(latest.data);
  const recorded = [...(binding.inputs ?? []), ...(binding.outputs ?? [])];
  if (recorded.length === 0) {
    return { state: "invalidated", reason: "the approval named no artifacts, so there is nothing it could have reviewed" };
  }
  for (const { path: relative, sha256 } of recorded) {
    let current;
    try {
      [current] = await hashArtifacts(episodeDir, [relative]);
    } catch (err) {
      return { state: "invalidated", reason: err.message };
    }
    if (current.sha256 !== sha256) {
      return { state: "invalidated", reason: `"${relative}" changed since it was approved` };
    }
  }
  return { state: "approved", at: latest.at, origin };
}
```

Update `gate-review.d.mts` to the new signatures and state union (add `"rejected"` with `note?: string`, `origin` on requested/approved/rejected, `opts?: { key?: string | null; planHash?: string }`).

Schema `gate-review.schema.json` `GateReview`: `required: ["stageId","decision","origin","actor","at","binding","checks"]`; `decision` enum gains `"rejected"` (replace the "deliberately no rejected" description with "rejected rides in approval-rejected"); add `origin: { enum: ["human","agent","policy"] }`, `binding: { type: object, additionalProperties: false, required: ["inputs","outputs"], properties: { planHash: { type: string, pattern: "^[0-9a-f]{64}$" }, inputs: {...ArtifactHash array}, outputs: {...} } }`, `signature: { type: string, pattern: "^[0-9a-f]{64}$" }`; remove top-level `inputs`/`outputs`. `allOf`: approved ⇒ `binding.outputs minItems 1` and `binding required planHash`; rejected ⇒ `required: ["note"]`; `origin: human` and decision in approved/rejected ⇒ `required: ["signature"]`.

Fixtures: rewrite `valid/approved.json` and `valid/requested.json` to v2 (approved one with `origin: "human"` and a 64-hex `signature`), add `valid/rejected.json`, `invalid/human-approved-unsigned.json`, `invalid/rejected-without-note.json`; register them in `check-gate-review-fixtures.mjs`.

Callers, still unsigned (Task 4 replaces `cmdApprove` entirely):
- `studio/runtime/src/cli.ts` `cmdApprove`: `buildGateReview({ stageId, decision: "approved", origin: "human", actor: "human", binding: { planHash: "0".repeat(64), outputs } })` with a comment `// Replaced by ExecutionService.review in Task 4 of the qr4.3 plan.`
- `studio/gateway/test/gate-enforcement.test.ts`: each `buildGateReview({... outputs })` becomes `buildGateReview({... origin: "human", binding: { planHash: "0".repeat(64), outputs } })`.

- [ ] **Step 4: Run to verify pass**

Run: `cd studio/contracts && npm test && npm run check:schemas`
Then: `cd studio/gateway && npx vitest run test/gate-enforcement.test.ts` and `cd studio/runtime && npm test -- test/integration/cli.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/contracts studio/runtime/src/cli.ts studio/gateway/test/gate-enforcement.test.ts
git commit -m "feat(contracts): a review says who decided, what it was bound to, and may reject"
```

---

### Task 3: `ExecutionService.review()` and principals (runtime)

**Files:**
- Modify: `studio/runtime/src/execution/types.ts`
- Modify: `studio/runtime/src/execution/service.ts` (new method after `complete`)
- Modify: `studio/runtime/src/index.ts` (export `Principal`, `ReviewInput`)
- Test: `studio/runtime/test/unit/execution/review.test.ts` (new); reuse `test/unit/execution/helpers/review-chain.ts`

**Interfaces:**
- Consumes: `buildGateReview`, `REVIEW_EVENT_FOR`, `hashArtifacts` (Task 2); `signReceipt`, `planHashOf` (Task 1)
- Produces:
  - `export type Principal = "operator" | "agent";`
  - `export interface ReviewInput { decision: "approved" | "rejected"; principal: Principal; note?: string }`
  - `OutcomeStatus` gains `"requested" | "approved" | "rejected"`
  - `ExecutionServiceOptions.operatorKey?: string | null`
  - `ExecutionService.review(ref: EpisodeRef, pipeline: string, stageId: string, input: ReviewInput): Promise<Result<StageOutcome, ExecutionError>>`

- [ ] **Step 1: Write the failing tests**

`studio/runtime/test/unit/execution/review.test.ts` — same scaffolding as `review-gate.test.ts` (`episode()`, `writer(dir)`, `budget`, `reviewChainPipeline`). In `review-chain`, `gated` declares `review: human`; add a stage `skilled` with `review: skill` to the helper if it lacks one (depends on `upstream`, `autopilot: true`).

```ts
import { readFile } from "node:fs/promises";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { verifyReceipt } from "@studio/contracts/src/receipt.mjs";

const KEY = "operator-key-for-tests";
async function journal(dir: string) {
  return parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"), { strict: true });
}

describe("ExecutionService.review", () => {
  async function completed(stage: string, operatorKey: string | null = KEY) {
    const { root, dir } = await episode();
    const pipelines = await reviewChainPipeline(roots);
    const svc = new ExecutionService({ libraryRoot: root, builtinPipelines: pipelines,
      dispatcher: writer(dir), budget, review: permissive, operatorKey });
    await svc.run(REF, "review-chain", { stage: "upstream" });
    await svc.run(REF, "review-chain", { stage });
    return { svc, dir };
  }

  it("writes a signed human grant for the operator", async () => {
    const { svc, dir } = await completed("gated");
    const out = await svc.review(REF, "review-chain", "gated", { decision: "approved", principal: "operator" });
    expect(out.ok && out.value.status).toBe("approved");
    const grant = (await journal(dir)).filter((e) => e.type === "approval-granted").at(-1)!;
    expect(grant.actor).toBe("runtime");
    expect((grant.data as any).origin).toBe("human");
    expect((grant.data as any).binding.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyReceipt(grant.data as object, KEY)).toBe(true);
  });

  it("turns an agent's approval of a human gate into a request, and says so", async () => {
    const { svc, dir } = await completed("gated");
    const out = await svc.review(REF, "review-chain", "gated", { decision: "approved", principal: "agent" });
    expect(out.ok && out.value.status).toBe("requested");
    expect(out.ok && out.value.reason).toMatch(/operator/);
    const types = (await journal(dir)).map((e) => e.type);
    expect(types).not.toContain("approval-granted");
    expect(types.at(-1)).toBe("approval-requested");
  });

  it("lets an agent grant a skill review, unsigned", async () => {
    const { svc, dir } = await completed("skilled");
    const out = await svc.review(REF, "review-chain", "skilled", { decision: "approved", principal: "agent" });
    expect(out.ok && out.value.status).toBe("approved");
    const grant = (await journal(dir)).filter((e) => e.type === "approval-granted").at(-1)!;
    expect((grant.data as any).origin).toBe("agent");
    expect((grant.data as any).signature).toBeUndefined();
  });

  it("records an operator's rejection with its note, signed", async () => {
    const { svc, dir } = await completed("gated");
    const out = await svc.review(REF, "review-chain", "gated", { decision: "rejected", principal: "operator", note: "too dark" });
    expect(out.ok && out.value.status).toBe("rejected");
    const rej = (await journal(dir)).at(-1)!;
    expect(rej.type).toBe("approval-rejected");
    expect(verifyReceipt(rej.data as object, KEY)).toBe(true);
  });

  it("refuses an operator review when no key is configured to sign with", async () => {
    const { svc } = await completed("gated", null);
    const out = await svc.review(REF, "review-chain", "gated", { decision: "approved", principal: "operator" });
    expect(out.ok && out.value.status).toBe("blocked");
    expect(out.ok && out.value.reason).toMatch(/no operator key/);
  });

  it("refuses a stage that has not completed", async () => {
    const { root } = await episode();
    const svc = new ExecutionService({ libraryRoot: root, builtinPipelines: await reviewChainPipeline(roots),
      budget, operatorKey: KEY });
    const out = await svc.review(REF, "review-chain", "gated", { decision: "approved", principal: "operator" });
    expect(out.ok && out.value.status).toBe("blocked");
    expect(out.ok && out.value.reason).toMatch(/has not completed/);
  });

  it("refuses a stage that declares no review", async () => {
    const { svc } = await completed("upstream");
    const out = await svc.review(REF, "review-chain", "upstream", { decision: "approved", principal: "operator" });
    expect(out.ok && out.value.status).toBe("blocked");
    expect(out.ok && out.value.reason).toMatch(/declares no review/);
  });

  it("returns STAGE_UNKNOWN for a stage the pipeline does not declare", async () => {
    const { svc } = await completed("gated");
    const out = await svc.review(REF, "review-chain", "nope", { decision: "approved", principal: "operator" });
    expect(!out.ok && out.error.code).toBe("STAGE_UNKNOWN");
  });
});
```

Add a failed-append case using the same technique the existing `fail-closed.test.ts` uses to make `appendJournalEvent` return null (read that file and copy its mechanism); assert `status: "blocked"` and reason `/could not be written/`.

- [ ] **Step 2: Run to verify failure**

Run: `cd studio/runtime && npx tsc -p . && npx vitest run test/unit/execution/review.test.ts`
Expected: FAIL — `svc.review is not a function` (or a type error on `operatorKey`).

- [ ] **Step 3: Implement types**

In `types.ts`:

```ts
/**
 * Who is asking. Resolved by the caller from a credential — the gateway from
 * which token a request carried, the CLI from whether it can read the
 * operator key — and never from anything the caller merely says about itself.
 * Omitted means `agent`: omission never grants.
 */
export type Principal = "operator" | "agent";

export interface ReviewInput {
  decision: "approved" | "rejected";
  principal: Principal;
  /** Required for a rejection. */
  note?: string;
}
```

Add `| "requested" | "approved" | "rejected"` to `OutcomeStatus`; add to `ExecutionServiceOptions`:

```ts
  /**
   * The key human receipts are signed with (avg-qr4.3). Null or absent means
   * this composition cannot sign, so an operator review is refused rather than
   * written unsigned.
   */
  operatorKey?: string | null;
```

- [ ] **Step 4: Implement `review()`**

In `service.ts`, import `buildGateReview, hashArtifacts, REVIEW_EVENT_FOR` from `@studio/contracts/src/gate-review.mjs` and `signReceipt, planHashOf` from `@studio/contracts/src/receipt.mjs`. Add after `complete`:

```ts
  /**
   * Record a decision about a completed stage. The only code that writes a
   * review event, so every caller's approval means the same thing.
   *
   * Origin comes from the principal, never from the request: an `operator`
   * decides as `human` and the receipt is signed; an `agent` decides as
   * `agent`. An agent asking to approve or reject a `review: human` stage is
   * not refused — it is downgraded to a request, so a headless caller stops
   * with an explicit ask instead of assuming yes (harness review, P0).
   */
  async review(
    ref: EpisodeRef,
    pipeline: string,
    stageId: string,
    input: ReviewInput,
  ): Promise<Result<StageOutcome, ExecutionError>> {
    const startedAt = Date.now();
    const resolved = await this.resolve(pipeline);
    if (!resolved.ok) return resolved;
    const stage = resolved.value.stages.find((s) => s.definition.id === stageId);
    if (!stage) {
      return err({ code: "STAGE_UNKNOWN", message: `Pipeline "${pipeline}" declares no stage "${stageId}"` });
    }
    const blocked = (reason: string): Result<StageOutcome, ExecutionError> =>
      ok({ stageId, status: "blocked", reason, outputs: [], durationMs: Date.now() - startedAt });

    const level = stage.definition.gates.review;
    if (level === "none") return blocked(`"${stageId}" declares no review, so there is nothing to decide`);

    const episodeDir = this.episodeDir(ref);
    const events = await this.readJournal(episodeDir);
    if (!events.ok) return events;
    let derived;
    try {
      derived = deriveExecutionState(events.value, resolved.value.stages.map((s) => s.definition.id), this.now());
    } catch (e) {
      return err({ code: "REPLAY_INVALID", message: `Journal and pipeline disagree: ${e instanceof Error ? e.message : String(e)}` });
    }
    const instance = derived.get(stageId)!;
    if (instance.status !== "completed") {
      return blocked(`"${stageId}" has not completed, so there is nothing to review`);
    }
    if (instance.outputArtifacts.length === 0) {
      return blocked(`"${stageId}" recorded no outputs, and a decision about nothing cannot be invalidated by anything`);
    }

    let outputs;
    try {
      outputs = await hashArtifacts(episodeDir, instance.outputArtifacts);
    } catch (e) {
      return blocked(`"${stageId}" cannot be reviewed: ${e instanceof Error ? e.message : String(e)}`);
    }

    const asAgentOnHumanGate = input.principal !== "operator" && level === "human";
    const decision = asAgentOnHumanGate ? "requested" : input.decision;
    const origin = input.principal === "operator" ? "human" : "agent";
    if (origin === "human" && !this.options.operatorKey) {
      return blocked(`no operator key is configured to sign with, so a human decision about "${stageId}" cannot be recorded`);
    }

    let record;
    try {
      record = buildGateReview({
        stageId, decision,
        origin: decision === "requested" ? "agent" : origin,
        actor: "runtime",
        binding: { planHash: planHashOf(stage.definition), outputs },
        ...(input.note !== undefined ? { note: input.note } : {}),
      });
    } catch (e) {
      return blocked(e instanceof Error ? e.message : String(e));
    }
    if (decision !== "requested" && origin === "human") record = signReceipt(record, this.options.operatorKey!);

    // Under the stage's own lock, so a decision cannot interleave with a
    // re-run of the stage it is about. A live lease means the stage is
    // running, and `instance.status` above has already refused that; the lock
    // closes the window between that read and this write.
    const lock = this.lock(episodeDir);
    const lease = await lock.acquire(`stage:${stageId}`, 30_000);
    if (!lease.ok) return blocked(`"${stageId}" is held by a run; try again when it finishes`);
    let written;
    try {
      written = await appendJournalEvent(episodeDir, {
        type: REVIEW_EVENT_FOR[decision], actor: "runtime", episode: ref, data: { ...record },
      });
    } finally {
      await lock.release(lease.value);
    }
    if (!written) return blocked(`the ${decision} decision for "${stageId}" could not be written to the journal`);

    return ok({
      stageId,
      status: decision,
      outputs: instance.outputArtifacts,
      durationMs: Date.now() - startedAt,
      ...(asAgentOnHumanGate
        ? { reason: `"${stageId}" declares human review; approval requested — an operator must approve it` }
        : {}),
    });
  }
```

Check `FileLock.acquire`'s return shape in `studio/runtime/src/ports/file-lock.ts:87` and adapt `lease.ok`/`lease.value` if the `Result` fields differ.

Export `Principal` and `ReviewInput` from `studio/runtime/src/index.ts` alongside the other execution types.

- [ ] **Step 5: Run to verify pass**

Run: `cd studio/runtime && npx tsc -p . && npx vitest run test/unit/execution/`
Expected: PASS, including the existing execution tests.

- [ ] **Step 6: Commit**

```bash
git add studio/runtime
git commit -m "feat(runtime): one entry point for review decisions, origin from the principal"
```

---

### Task 4: `vpr approve` and `vpr reject` through the service (CLI)

**Files:**
- Create: `studio/runtime/src/execution/principal.ts`
- Modify: `studio/runtime/src/cli.ts` (`cmdApprove` rewritten, `cmdReject` added, `makeService` gains `operatorKey`, `COMMANDS`)
- Modify: `studio/gateway/.gitignore`, root `.gitignore` (add `.operator-key`)
- Test: `studio/runtime/test/unit/execution/principal.test.ts`, `studio/runtime/test/integration/cli.test.ts` (`vpr approve` block)

**Interfaces:**
- Consumes: `readOperatorKey`, `OPERATOR_KEY_ENV` (Task 1); `ExecutionService.review` (Task 3)
- Produces:
  - `defaultOperatorKeyPath(): string` — `<repo>/studio/gateway/.operator-key`, resolved from this module's location
  - `resolveCliCredential(env?: NodeJS.ProcessEnv): { principal: Principal; operatorKey: string | null }` — throws on a key with loose permissions

- [ ] **Step 1: Write the failing tests**

`principal.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCliCredential, defaultOperatorKeyPath } from "../../../src/execution/principal.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

describe("resolveCliCredential", () => {
  it("is the operator when the key file reads", async () => {
    const d = await mkdtemp(join(tmpdir(), "cred-")); dirs.push(d);
    await writeFile(join(d, "k"), "secret", { mode: 0o600 });
    expect(resolveCliCredential({ AVG_OPERATOR_KEY_FILE: join(d, "k") })).toEqual({ principal: "operator", operatorKey: "secret" });
  });
  it("is an agent with no key file: headless, not an error", async () => {
    const d = await mkdtemp(join(tmpdir(), "cred-")); dirs.push(d);
    expect(resolveCliCredential({ AVG_OPERATOR_KEY_FILE: join(d, "absent") })).toEqual({ principal: "agent", operatorKey: null });
  });
  it("throws on a key other users can read", async () => {
    const d = await mkdtemp(join(tmpdir(), "cred-")); dirs.push(d);
    await writeFile(join(d, "k"), "secret"); await chmod(join(d, "k"), 0o644);
    expect(() => resolveCliCredential({ AVG_OPERATOR_KEY_FILE: join(d, "k") })).toThrow(/0600/);
  });
  it("defaults to the file the gateway writes", () => {
    expect(defaultOperatorKeyPath()).toMatch(/studio[\\/]gateway[\\/]\.operator-key$/);
  });
});
```

In `test/integration/cli.test.ts`, rewrite the `vpr approve` block. The `vpr(...)` helper must pass `env: { ...process.env, AVG_OPERATOR_KEY_FILE: <file> }`; add an `env` parameter to it if it has none. Cases:

```ts
it("with the operator key, records a signed human approval", async () => {
  // key written 0600 into the test's tmp root
  const r = vpr(["approve", "childrens/fairy-tales/ep", "narration", "--library", root, "--json"], { AVG_OPERATOR_KEY_FILE: keyFile });
  expect(r.status).toBe(0);
  const grant = (await events(dir)).filter((e) => e.type === "approval-granted").at(-1)!;
  expect(verifyReceipt(grant.data as object, KEY)).toBe(true);
});

it("without the key, exits non-zero and leaves a request for an operator", async () => {
  const r = vpr(["approve", "childrens/fairy-tales/ep", "narration", "--library", root, "--json"], { AVG_OPERATOR_KEY_FILE: join(root, "absent") });
  expect(r.status).not.toBe(0);
  expect(r.stdout + r.stderr).toMatch(/approval requested/);
  expect((await events(dir)).at(-1)!.type).toBe("approval-requested");
});

it("vpr reject records a signed rejection with its note", async () => {
  const r = vpr(["reject", "childrens/fairy-tales/ep", "narration", "--note", "too quiet", "--library", root, "--json"], { AVG_OPERATOR_KEY_FILE: keyFile });
  expect(r.status).toBe(0);
  const rej = (await events(dir)).at(-1)!;
  expect(rej.type).toBe("approval-rejected");
  expect((rej.data as any).note).toBe("too quiet");
});

it("vpr reject without --note is a usage error and writes nothing", async () => { /* status EX_USAGE, journal unchanged */ });
```

Keep the existing "is invalidated when an approved artifact changes afterwards" case, now run with the key. `narration` must declare `review: human` or `skill` in the pipeline the test uses — check the existing test's setup and keep its pipeline.

- [ ] **Step 2: Run to verify failure**

Run: `cd studio/runtime && npm test -- test/unit/execution/principal.test.ts test/integration/cli.test.ts`
Expected: FAIL — module not found; `reject` unknown command.

- [ ] **Step 3: Implement `principal.ts`**

```ts
// ---------------------------------------------------------------------------
// Who the CLI is
// ---------------------------------------------------------------------------
// The CLI has no bearer token to present; what it has is the filesystem. A
// caller that can read the operator key is the operator (avg-qr4.3). One that
// cannot is headless: it may request approval but not grant it.
// ---------------------------------------------------------------------------

import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { readOperatorKey, OPERATOR_KEY_ENV } from "@studio/contracts/src/operator-key.mjs";
import type { Principal } from "./types.js";

/** Where the gateway writes the key: studio/gateway/.operator-key. */
export function defaultOperatorKeyPath(): string {
  // dist/src/execution/principal.js or src/execution/principal.ts → studio/runtime
  const here = path.dirname(fileURLToPath(import.meta.url));
  const runtimeRoot = here.includes(`${path.sep}dist${path.sep}`)
    ? path.resolve(here, "..", "..", "..")
    : path.resolve(here, "..", "..");
  return path.resolve(runtimeRoot, "..", "gateway", ".operator-key");
}

export function resolveCliCredential(
  env: NodeJS.ProcessEnv = process.env,
): { principal: Principal; operatorKey: string | null } {
  const operatorKey = readOperatorKey(env[OPERATOR_KEY_ENV] || defaultOperatorKeyPath());
  return operatorKey ? { principal: "operator", operatorKey } : { principal: "agent", operatorKey: null };
}
```

- [ ] **Step 4: Rewrite `cmdApprove`, add `cmdReject`**

Replace the body of `cmdApprove` (cli.ts:507-611) with a shared `cmdReview(ctx, args, decision)`:

```ts
async function cmdReview(ctx: CliContext, args: string[], decision: "approved" | "rejected"): Promise<number> {
  const verb = decision === "approved" ? "approve" : "reject";
  if (args.length < 2) {
    emit(ctx, { error: `Usage: vpr ${verb} <channel>/<series>/<episode> <stage-id>${decision === "rejected" ? " --note <text>" : ""}` });
    return EX_USAGE;
  }
  const pathArg = args[0]!;
  const stageId = args[1]!;
  const note = flagValue(args, "--note");
  if (decision === "rejected" && !note) {
    emit(ctx, { error: "vpr reject needs --note: a rejection nobody can act on is noise" });
    return EX_USAGE;
  }
  const parsed = parsePath(pathArg);
  if (!parsed) {
    emit(ctx, { error: `Invalid path "${pathArg}" (expected <channel>/<series>/<episode>)` });
    return EX_USAGE;
  }
  if (ctx.dryRun) {
    emit(ctx, { message: `[DRY RUN] Would ${verb} stage "${stageId}" for ${pathArg}`, dryRun: true });
    return EX_OK;
  }

  let credential;
  try {
    credential = resolveCliCredential();
  } catch (e) {
    emit(ctx, { error: `${e instanceof Error ? e.message : String(e)}. Nothing was recorded.` });
    return EX_RUNTIME;
  }

  const service = makeService(args, claimTtlMs(), credential.operatorKey);
  const pipeline = flagValue(args, "--pipeline") ?? (await episodePipeline(args, parsed));
  const out = await service.review(parsed, pipeline, stageId, { decision, principal: credential.principal, note });
  if (!out.ok) {
    emit(ctx, { error: out.error.message, code: out.error.code });
    return EX_RUNTIME;
  }
  const o = out.value;
  emit(ctx, { message: o.reason ?? `Stage "${stageId}" ${o.status} for ${pathArg}`, path: pathArg, stageId, status: o.status });
  return o.status === decision ? EX_OK : EX_RUNTIME;
}

async function cmdApprove(ctx: CliContext, args: string[]): Promise<number> { return cmdReview(ctx, args, "approved"); }
async function cmdReject(ctx: CliContext, args: string[]): Promise<number> { return cmdReview(ctx, args, "rejected"); }
```

`flagValue`, `claimTtlMs` and how `cmdRun` finds the episode's pipeline already exist in `cli.ts`. Reuse whatever `cmdRun` uses for the pipeline name and do not add `episodePipeline` if an equivalent exists. `makeService(args, leaseTtlMs, operatorKey: string | null)` passes `operatorKey` into the options. Its other callers pass `resolveCliCredential().operatorKey` (Task 7 needs the principal too). Delete the now-unused hashing and journal-reading imports from `cmdApprove`.

Add `reject` to `COMMANDS`:

```ts
  reject: { name: "reject", description: "Reject a stage's output, with a reason", usage: "vpr reject <channel>/<series>/<episode> <stage-id> --note <text> [--json] [--dry-run]", examples: ["vpr reject my-channel/my-series/ep001 script --note 'the wolf is too frightening'"], run: cmdReject },
```

Add `.operator-key` under `.gateway-token` in both `.gitignore` files.

- [ ] **Step 5: Run to verify pass**

Run: `cd studio/runtime && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/runtime .gitignore studio/gateway/.gitignore
git commit -m "feat(runtime): vpr approve and vpr reject decide through the service"
```

---

### Task 5: Operator credential and principals in the gateway

**Files:**
- Modify: `studio/gateway/src/config/schema.ts` (add `operatorKey`), `config/defaults.ts`
- Modify: `studio/gateway/src/auth/token.ts` (add `resolveOperatorKey`), `auth/index.ts` (export)
- Modify: `studio/gateway/src/auth/middleware.ts`
- Modify: `studio/gateway/src/server.ts` (resolve key; middleware; WS; routes option)
- Modify: `studio/gateway/src/events/bus.ts:189-245` (`register` takes accepted credentials)
- Modify: `studio/gateway/src/runtime/service.ts` (`makeExecutionService(log, libraryRoot, operatorKey)`)
- Modify: `studio/gateway/src/routes/production.ts` (options `operatorKey`; `/approve` via service; new `/reject`)
- Modify: `studio/gateway/src/runtime/client.ts` (delete `approve`)
- Test: `studio/gateway/test/auth-principal.test.ts` (new), `studio/gateway/test/review-routes.test.ts` (new)

**Interfaces:**
- Consumes: `readOperatorKey` (Task 1); `ExecutionService.review`, `Principal` (Task 3)
- Produces:
  - `request.principal: "operator" | "agent"` (Fastify request decoration)
  - `createAuthMiddleware(token: string, operatorKey: string, allowDevToken?: boolean)`
  - `resolveOperatorKey(file: string): string` — generates 0600 if absent (via `resolveToken`), then enforces permissions with `readOperatorKey`
  - `makeExecutionService(log, libraryRoot, operatorKey: string | null)`
  - `registerProductionRoutes(app, runtime, workspace, { ..., operatorKey: string | null })`
  - `POST .../stages/:stage/reject` body `{ note: string }` → `{ ok: true, outcome }`
  - `POST .../stages/:stage/approve` → `{ ok: true, outcome }` (was `{ ok, data, error }` from a subprocess)

- [ ] **Step 1: Write the failing auth test**

`auth-principal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { createAuthMiddleware } from "../src/auth/middleware.js";

async function app(allowDev = false) {
  const a = Fastify();
  const mw = createAuthMiddleware("agent-token", "operator-key", allowDev);
  a.addHook("preHandler", mw);
  a.get("/who", async (req) => ({ principal: req.principal }));
  return a;
}
const who = async (auth: string, allowDev = false) =>
  (await (await app(allowDev)).inject({ url: "/who", headers: { authorization: auth } }));

describe("principal", () => {
  it("operator key → operator", async () => expect((await who("Bearer operator-key")).json().principal).toBe("operator"));
  it("agent token → agent", async () => expect((await who("Bearer agent-token")).json().principal).toBe("agent"));
  it("dev-token is never an operator", async () => expect((await who("Bearer dev-token", true)).json().principal).toBe("agent"));
  it("anything else is 401", async () => expect((await who("Bearer nope")).statusCode).toBe(401));
  it("refuses an operator key equal to the agent token: the two would be indistinguishable", () =>
    expect(() => createAuthMiddleware("same", "same")).toThrow(/distinct/));
});
```

- [ ] **Step 2: Write the failing route test**

`review-routes.test.ts` — build the app the way `single-stage-route.test.ts:appWithEpisode` does (copy its setup: throwaway library, decoy `AVG_LIBRARY_ROOT`, shipped manifests), passing `operatorKey: KEY` to `registerProductionRoutes`, and add a hook that sets the principal from a test header:

```ts
app.addHook("preHandler", async (req) => {
  (req as any).principal = req.headers["x-test-principal"] === "operator" ? "operator" : "agent";
});
```

Drive a `review: human` stage to completed with the claim/complete routes (as `single-stage-route.test.ts` does), then:

```ts
it("approve with the operator credential writes a signed grant", async () => {
  const res = await app.inject({ method: "POST", url: `${BASE}/stages/${STAGE}/approve`, headers: { "x-test-principal": "operator" }, payload: {} });
  expect(res.json().outcome.status).toBe("approved");
});
it("approve with the agent credential yields a request, not a grant", async () => {
  const res = await app.inject({ method: "POST", url: `${BASE}/stages/${STAGE}/approve`, payload: {} });
  expect(res.json().outcome.status).toBe("requested");
});
it("reject requires a note", async () => {
  const res = await app.inject({ method: "POST", url: `${BASE}/stages/${STAGE}/reject`, headers: { "x-test-principal": "operator" }, payload: {} });
  expect(res.statusCode).toBe(400);
});
it("reject with a note records it", async () => {
  const res = await app.inject({ method: "POST", url: `${BASE}/stages/${STAGE}/reject`, headers: { "x-test-principal": "operator" }, payload: { note: "no" } });
  expect(res.json().outcome.status).toBe("rejected");
});
it("a route with no principal set is an agent", async () => { /* app built without the hook; approve → requested */ });
```

Pick `STAGE` = a shipped `review: human` stage whose dependencies the test can complete (`script` in `narrated-illustrated-video` if its deps are reachable, otherwise the review-chain helper pipeline copied into the throwaway library).

- [ ] **Step 3: Run to verify failure**

Run: `cd studio/gateway && npx vitest run test/auth-principal.test.ts test/review-routes.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement middleware**

```ts
declare module "fastify" {
  interface FastifyRequest {
    isAuthenticated: boolean;
    /**
     * Which credential authenticated this request (avg-qr4.3). The browser
     * and CLI hold the operator key; Pi holds the agent token. Only a review
     * decision and an attended claim look at the difference.
     */
    principal: "operator" | "agent";
  }
}

export function createAuthMiddleware(token: string, operatorKey: string, allowDevToken = false) {
  if (token === operatorKey) {
    throw new Error("The operator key and the gateway token must be distinct, or the two principals are indistinguishable");
  }
  const accepted = new Map<string, "operator" | "agent">([
    [`Bearer ${operatorKey}`, "operator"],
    [`Bearer ${token}`, "agent"],
    // dev-token is a convenience for local development, never a person.
    ...(allowDevToken ? [["Bearer dev-token", "agent"] as const] : []),
  ]);
  return async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authHeader = request.headers.authorization;
    if (!authHeader) { /* existing 401 body, unchanged */ return; }
    let principal: "operator" | "agent" | undefined;
    const candidate = Buffer.from(authHeader);
    for (const [expected, who] of accepted) {
      const buf = Buffer.from(expected);
      // Keep scanning after a match so timing does not reveal which credential matched.
      if (buf.length === candidate.length && timingSafeEqual(buf, candidate)) principal = who;
    }
    if (!principal) { /* existing invalid-token 401 body, unchanged */ return; }
    request.isAuthenticated = true;
    request.principal = principal;
  };
}
```

In `server.ts`, add `app.decorateRequest("principal", "agent")` before the hooks so routes registered without the auth hook (tests) read `agent`.

- [ ] **Step 5: Implement key resolution, WS, composition, routes**

- `schema.ts`: `operatorKey: z.object({ file: z.string().default(".operator-key") }).default({})` beside `token`.
- `token.ts`:

```ts
/**
 * The operator key: generated like the token, then held to the same 0600
 * rule by the reader the CLI uses, so the two cannot disagree about what a
 * valid key file is.
 */
export function resolveOperatorKey(file: string): string {
  resolveToken({ file });
  const key = readOperatorKey(resolve(file));
  if (!key) throw new TokenError(`Operator key "${file}" could not be created`);
  return key;
}
```

- `server.ts` `createGateway`: `const operatorKey = resolveOperatorKey(config.operatorKey.file);` next to the auth block; `createAuthMiddleware(token, operatorKey, config.token.allowDevToken)`; `events.register(app, [token, operatorKey])`; pass `operatorKey` wherever `registerProductionRoutes` and any other `makeExecutionService` caller get `libraryRoot` (grep `makeExecutionService(` for all sites: routes, workspace enrichment, publisher). The publisher and enrichment only read status, so they pass `operatorKey` too. Task 6's gate needs it to verify.
- `bus.ts` `register(fastify, accepted: string[])`: `if (!queryToken || !accepted.includes(queryToken))` → existing refusal.
- `runtime/service.ts`: `makeExecutionService(log, libraryRoot, operatorKey: string | null)` sets `operatorKey` in options. The parameter is required, same reasoning as `libraryRoot`: document it.
- `production.ts`: options gain `operatorKey: string | null`; `serviceFor` passes it. Replace the approve handler body and add reject:

```ts
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const stageId = (request.params as Record<string, string>).stage!;
    const pipeline = await inheritedPipeline(workspace, ref) ?? DEFAULT_PIPELINE;
    const outcome = await serviceFor(request).review(ref, pipeline, stageId, {
      decision: "approved", principal: request.principal ?? "agent",
    });
    return outcome.ok ? { ok: true, outcome: outcome.value } : { ok: false, error: outcome.error };
  });
```

Reject route: same params schema; body schema `{ type: "object", required: ["note"], properties: { note: { type: "string", minLength: 1 } } }` (Fastify returns 400 on violation); `decision: "rejected"`, `note`.
- `client.ts`: delete `approve()`; fix any compile errors from its callers (there should be none left besides the route).

Update existing tests that construct `createAuthMiddleware(token, allowDev)` or `events.register(app, token)` to the new signatures.

- [ ] **Step 6: Run to verify pass**

Run: `cd studio/gateway && npx tsc --noEmit -p . && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add studio/gateway
git commit -m "feat(gateway): an operator credential, and a principal on every request"
```

---

### Task 6: Enforcement — signatures, plan binding, and review levels

This is the task that makes a forged line stop counting.

**Files:**
- Modify: `studio/contracts/src/gate-review.mjs` (`deriveGateState` checks), `gate-review.d.mts`
- Create: `studio/runtime/src/execution/journal-review-gate.ts`
- Modify: `studio/runtime/src/execution/types.ts` (`ReviewGate.isOutstanding` gains `stage`)
- Modify: `studio/runtime/src/execution/service.ts` (`whyBlocked` passes the dep stage; `status()` asks the gate about completed reviewed stages)
- Modify: `studio/runtime/src/cli.ts` (`makeService` injects `JournalReviewGate`), `studio/runtime/src/index.ts` (export)
- Modify: `studio/gateway/src/runtime/service.ts` (inject `JournalReviewGate`); delete `studio/gateway/src/runtime/review-gate.ts` and move its test cases
- Modify tests that record human grants by hand: `studio/gateway/test/gate-enforcement.test.ts`, `studio/runtime/test/unit/execution/status.test.ts` (sign with a test key via `signReceipt`, and set a real `planHash` via `planHashOf(stage.definition)`)
- Test: `studio/contracts/test/gate-review.test.mjs`, `studio/runtime/test/unit/execution/journal-review-gate.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 1–3
- Produces:
  - `deriveGateState(events, stageId, episodeDir, { key, planHash })` adds `{ state: "unverifiable", reason }` and the invalidation reasons below
  - `ReviewGate.isOutstanding(stageId: string, episodeDir: string, stage?: ResolvedStage): Promise<ReviewVerdict>`
  - `class JournalReviewGate implements ReviewGate { constructor(key: string | null) }`
  - `REVIEW_SATISFIED_BY: Record<string, readonly ("human" | "agent" | "policy")[]>` = `{ human: ["human"], skill: ["human", "agent"], "human-or-skill": ["human", "agent"] }`

- [ ] **Step 1: Write the failing contracts tests**

Add to `gate-review.test.mjs` `deriveGateState`:

```js
import { signReceipt, planHashOf } from "../src/receipt.mjs";
const KEY = "test-operator-key";
const PLAN = planHashOf({ id: "s" });

async function humanGrant(sign = true, planHash = PLAN) {
  await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
  const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
  const data = buildGateReview({ stageId: "s", decision: "approved", origin: "human", actor: "runtime", binding: { planHash, outputs } });
  return { type: "approval-granted", actor: "runtime", at: data.at, data: sign ? signReceipt(data, KEY) : data };
}

it("approves a signed human grant for the same plan", async () => {
  const s = await deriveGateState([await humanGrant()], "s", dir, { key: KEY, planHash: PLAN });
  assert.equal(s.state, "approved"); assert.equal(s.origin, "human");
});
it("reads an unsigned human grant as invalidated: unsigned", async () => {
  const s = await deriveGateState([await humanGrant(false)], "s", dir, { key: KEY, planHash: PLAN });
  assert.equal(s.state, "invalidated"); assert.match(s.reason, /unsigned/);
});
it("reads a tampered human grant as invalidated", async () => {
  const e = await humanGrant(); e.data = { ...e.data, stageId: "s", note: "x", origin: "human", at: "2030-01-01T00:00:00Z" };
  const s = await deriveGateState([e], "s", dir, { key: KEY, planHash: PLAN });
  assert.equal(s.state, "invalidated"); assert.match(s.reason, /does not verify/);
});
it("reads a human grant as unverifiable without a key", async () => {
  const s = await deriveGateState([await humanGrant()], "s", dir, { planHash: PLAN });
  assert.equal(s.state, "unverifiable");
});
it("invalidates when the stage definition changed", async () => {
  const s = await deriveGateState([await humanGrant(true, planHashOf({ id: "s", old: true }))], "s", dir, { key: KEY, planHash: PLAN });
  assert.equal(s.state, "invalidated"); assert.match(s.reason, /stage definition changed/);
});
it("reads a legacy actor:human record with no origin as invalidated: unsigned", async () => {
  await writeFile(path.join(dir, "artifacts", "x.md"), "v1");
  const outputs = await hashArtifacts(dir, ["artifacts/x.md"]);
  const legacy = { type: "approval-granted", actor: "human", data: { stageId: "s", decision: "approved", actor: "human", at: "t", inputs: [], outputs, checks: [] } };
  const s = await deriveGateState([legacy], "s", dir, { key: KEY, planHash: PLAN });
  assert.equal(s.state, "invalidated"); assert.match(s.reason, /unsigned/);
});
it("an unsigned human rejection is invalidated too — one rule both ways", async () => { /* approval-rejected, origin human, no signature */ });
it("an agent grant needs no signature", async () => { /* origin agent, planHash PLAN → approved, origin agent */ });
```

Remove the Task 2 test "reads a pre-v2 record's top-level inputs/outputs…approved" (this task deliberately inverts it; the legacy case above replaces it).

- [ ] **Step 2: Run to verify failure**

Run: `cd studio/contracts && node --test test/gate-review.test.mjs`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement the checks in `deriveGateState`**

Insert after the `approval-requested` return and change the rejected branch:

```js
  // Human decisions must prove their origin (avg-qr4.3). Checked for
  // rejections too: a forged rejection can only block, but one rule is
  // easier to trust than two.
  if (origin === "human") {
    if (!opts.key) {
      return { state: "unverifiable", reason: "this reader holds no operator key, so a human decision cannot be verified" };
    }
    if (typeof latest.data?.signature !== "string") {
      return { state: "invalidated", reason: "the human decision is unsigned, so nothing shows a person made it" };
    }
    if (!verifyReceipt(latest.data, opts.key)) {
      return { state: "invalidated", reason: "the human decision's signature does not verify" };
    }
  }
  if (latest.type === "approval-rejected") {
    return { state: "rejected", at: latest.at, origin, note: latest.data?.note };
  }

  const binding = bindingOf(latest.data);
  if (opts.planHash !== undefined && binding.planHash !== opts.planHash) {
    return { state: "invalidated", reason: "the stage definition changed since it was approved" };
  }
```

(then the existing artifact loop and the `approved` return). Import `verifyReceipt` from `./receipt.mjs`. Update the doc comment on `deriveGateState` to list the order of checks as the spec's §3 does.

- [ ] **Step 4: Write the failing runtime gate test**

`journal-review-gate.test.ts`: build a journal with `appendJournalEvent` in a temp episode, a fake `ResolvedStage` `{ definition: { id: "s", gates: { review: LEVEL, autopilot: true }, ... } }` (copy a real resolved stage shape from `test/unit/execution/helpers/review-chain.ts`), and check:

| level | receipt | verdict |
|---|---|---|
| `human` | signed human | `approved` |
| `human` | agent grant | `outstanding`, reason `/requires human review/` |
| `skill` | agent grant | `approved` |
| `human-or-skill` | agent grant | `approved` |
| `human` | policy grant | `outstanding` |
| `human` | unsigned human | `outstanding`, `/unsigned/` |
| `human` | rejected (signed) | `outstanding`, `/rejected: too dark/` |
| any | no journal | `no-record` |
| any | journal, no review | `no-record` |
| `human` | signed human, gate built with `null` key | `outstanding`, `/cannot be verified/` |
| `human` | called without `stage` | `outstanding`, `/definition/` |

- [ ] **Step 5: Implement `JournalReviewGate`**

```ts
// ---------------------------------------------------------------------------
// The review gate, read from the journal
// ---------------------------------------------------------------------------
// Moved from the gateway (it was GatewayReviewGate) so the CLI and the gateway
// consult the same gate: avg-qr4.3 made verifying a receipt need the operator
// key and the stage definition, and a CLI with no gate at all fell back to the
// manifest rule forever.
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { deriveGateState } from "@studio/contracts/src/gate-review.mjs";
import { planHashOf } from "@studio/contracts/src/receipt.mjs";
import type { ResolvedStage } from "../pipeline/types.js";
import type { ReviewGate, ReviewVerdict } from "./types.js";

/** Which origins satisfy a manifest's `gates.review`. Unlisted levels: none — fail closed. */
export const REVIEW_SATISFIED_BY: Readonly<Record<string, readonly string[]>> = Object.freeze({
  human: ["human"],
  skill: ["human", "agent"],
  "human-or-skill": ["human", "agent"],
});

export class JournalReviewGate implements ReviewGate {
  constructor(private readonly key: string | null) {}

  async isOutstanding(stageId: string, episodeDir: string, stage?: ResolvedStage): Promise<ReviewVerdict> {
    if (!stage) {
      return { state: "outstanding", reason: "cannot be judged without its definition, which a receipt is bound to" };
    }
    let events;
    try {
      events = parseJournal(await readFile(path.join(episodeDir, JOURNAL_RELATIVE_PATH), "utf-8"), { strict: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return { state: "no-record" };
      return { state: "outstanding", reason: `has a review that cannot be read: ${e instanceof Error ? e.message : String(e)}` };
    }

    const state = await deriveGateState(events, stageId, episodeDir, {
      key: this.key, planHash: planHashOf(stage.definition),
    });
    switch (state.state) {
      case "none": return { state: "no-record" };
      case "requested": return { state: "outstanding", reason: "is awaiting review" };
      case "rejected": return { state: "outstanding", reason: `was rejected: ${state.note}` };
      case "unverifiable": return { state: "outstanding", reason: `has a human decision that ${state.reason.replace(/^this reader holds no operator key, so a human decision /, "")}` };
      case "invalidated": return { state: "outstanding", reason: `has an invalidated review: ${state.reason}` };
      case "approved": {
        const level = stage.definition.gates.review;
        if ((REVIEW_SATISFIED_BY[level] ?? []).includes(state.origin)) return { state: "approved" };
        return { state: "outstanding", reason: `requires ${level} review, and the approval on record is from ${state.origin}` };
      }
    }
  }
}
```

(Simplify the `unverifiable` reason string to `"has a human decision that cannot be verified here"` if the replace reads awkwardly.)

In `types.ts`, change the port:

```ts
export interface ReviewGate {
  /**
   * `stage` is the definition the receipt is bound to (avg-qr4.3). Optional
   * so test fakes that ignore it still satisfy the port; a real gate refuses
   * without it.
   */
  isOutstanding(stageId: string, episodeDir: string, stage?: ResolvedStage): Promise<ReviewVerdict>;
}
```

In `service.ts` `whyBlocked`, find `depStage` before calling the gate and pass it: `this.options.review.isOutstanding(depId, episodeDir, depStage)`.

`status()`: replace the completed branch and its "known simplification" comment:

```ts
      if (instance.status === "completed") {
        if (stage.definition.gates.review === "none") {
          state = "completed";
        } else {
          // avg-qr4.3 defined what an approval is, so status no longer has to
          // guess: ask the gate, as a dependent would.
          let verdict = verdicts.get(stage.definition.id);
          if (!verdict && this.options.review) {
            verdict = await this.options.review.isOutstanding(stage.definition.id, episodeDir, stage);
            verdicts.set(stage.definition.id, verdict);
          }
          state = verdict?.state === "approved" ? "completed" : "awaiting_review";
          if (verdict?.state === "outstanding" && verdict.reason) {
            stateReason = `"${stage.definition.id}" ${verdict.reason}`;
          }
        }
      }
```

(`stateReason` is declared with `let` above; move the declaration if needed. Wrap the gate call in the same try/catch `status()` uses for `whyBlocked`.)

Compositions:
- `cli.ts` `makeService(..., operatorKey)`: `review: new JournalReviewGate(operatorKey)`.
- `gateway/src/runtime/service.ts`: `review: new JournalReviewGate(operatorKey)`; delete `review-gate.ts`; move any of its tests to the runtime test above.
- Export `JournalReviewGate` and `REVIEW_SATISFIED_BY` from `studio/runtime/src/index.ts`.

Fix hand-built human grants in `gate-enforcement.test.ts` and `status.test.ts`: sign them with the key the test's composition is given, and use the stage's real `planHashOf(definition)`. Where a test asserted the old behaviour ("approve then dependents run") keep the assertion. Where it relied on an unsigned human grant counting, invert the assertion and say why in the test name.

- [ ] **Step 6: Run everything touched**

Run: `cd studio/contracts && npm test && cd ../runtime && npm test && cd ../gateway && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add studio/contracts studio/runtime studio/gateway
git commit -m "feat: a human gate is satisfied only by a signed, current human receipt"
```

---

### Task 7: Attended claims

**Files:**
- Modify: `studio/runtime/src/execution/service.ts` (`claim`, `run`, `claimInternal`, `whyBlocked`)
- Modify: `studio/contracts/schemas/v1alpha1/execution-event.schema.json` (`StageLeased.attended`), and its fixtures if the check script lists valid ones
- Modify: `studio/runtime/src/cli.ts` (`cmdRun` passes principal)
- Modify: `studio/gateway/src/routes/production.ts` (single-stage execute, `/execute`, claim route pass `request.principal`)
- Test: `studio/runtime/test/unit/execution/attended.test.ts` (new); a case in `studio/gateway/test/single-stage-route.test.ts`

**Interfaces:**
- Consumes: `Principal` (Task 3)
- Produces: `claim(ref, pipeline, opts: { stage?: string; dryRun?: boolean; principal?: Principal })`, same for `run`; `stage-leased.data.attended: true` on operator claims

- [ ] **Step 1: Write the failing tests**

`attended.test.ts`, using a pipeline where one stage has `autopilot: false` (add `attended` to the review-chain helper: `autopilot: false`, `review: none`, depends on `upstream`):

```ts
it("refuses an agent the stage that autopilot: false reserves for a person", async () => {
  const out = await svc.claim(REF, "review-chain", { stage: "attended" });
  expect(out.ok && out.value.status).toBe("blocked");
  expect(out.ok && out.value.reason).toMatch(/autopilot: false.*operator/);
});
it("lets the operator take it, and the journal says a person did", async () => {
  const out = await svc.claim(REF, "review-chain", { stage: "attended", principal: "operator" });
  expect(out.ok && out.value.status).toBe("claimed");
  const leased = (await journal(dir)).filter((e) => e.type === "stage-leased").at(-1)!;
  expect((leased.data as any).attended).toBe(true);
});
it("does not mark an agent's lease as attended", async () => {
  await svc.claim(REF, "review-chain", { stage: "upstream" });
  const leased = (await journal(dir)).filter((e) => e.type === "stage-leased").at(-1)!;
  expect((leased.data as any).attended).toBeUndefined();
});
it("run honours the principal the same way", async () => {
  const out = await svc.run(REF, "review-chain", { stage: "attended", principal: "operator" });
  expect(out.ok && out.value.status).toBe("completed");
});
```

Gateway: the single-stage execute route with the `x-test-principal: operator` hook reaches `script`'s autopilot wall and passes it. Assert the refusal reason no longer mentions autopilot (the next wall, a dependency or dispatcher, is fine). Without the header, assert it is refused with `/autopilot: false/`.

- [ ] **Step 2: Run to verify failure**

Run: `cd studio/runtime && npx tsc -p . && npx vitest run test/unit/execution/attended.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `claimInternal` opts type gains `principal?: Principal`; pass `opts.principal ?? "agent"` into `whyBlocked` as a new last parameter `principal: Principal = "agent"`. `status()` passes nothing (so status says who may run it).
- In `whyBlocked` replace the attendance block's condition and message, keeping the comment's history and adding one paragraph:

```ts
    // avg-qr4.3 gave the service a way to know a person is at the controls:
    // the operator principal, resolved from a credential Pi is never given.
    if (!stage.definition.gates.autopilot && principal !== "operator") {
      return `"${stageId}" declares autopilot: false and may not run unattended; ` +
        `sign in as the operator to take this stage`;
    }
```

- `stage-leased` data: `{ stageId, leaseId, attemptNumber, ttlMs, expiresAt, holder, ...(principal === "operator" ? { attended: true } : {}) }`.
- `claim`/`run` public signatures: add `principal?: Principal` to opts and forward it.
- Schema: `StageLeased.properties.attended: { "const": true, "description": "Present when an operator took the stage (avg-qr4.3)." }`.
- `cli.ts` `cmdRun`: `const { principal, operatorKey } = resolveCliCredential()` (same try/catch as `cmdReview`) and pass `principal` to `service.claim`, `operatorKey` to `makeService`.
- `production.ts`: every `service.run(...)`/`service.claim(...)` call passes `principal: request.principal ?? "agent"`.

- [ ] **Step 4: Run to verify pass**

Run: `cd studio/contracts && npm run check:schemas && cd ../runtime && npm test && cd ../gateway && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio
git commit -m "feat: an operator may take a stage that autopilot: false reserves for a person"
```

---

### Task 8: A completed reviewed stage asks for its review

**Files:**
- Modify: `studio/runtime/src/execution/service.ts` (`complete`, after `sm.complete(instance)`)
- Test: `studio/runtime/test/unit/execution/review.test.ts` (add cases)

**Interfaces:**
- Consumes: `buildGateReview`, `hashArtifacts`, `planHashOf`
- Produces: an `approval-requested` event after every `stage-completed` of a stage with `gates.review !== "none"`, `origin: "policy"`, `binding.outputs` = hashed outputs

- [ ] **Step 1: Write the failing tests**

```ts
it("writes approval-requested right after a reviewed stage completes", async () => {
  const { dir } = await completed("gated");
  const tail = (await journal(dir)).slice(-2).map((e) => e.type);
  expect(tail).toEqual(["stage-completed", "approval-requested"]);
  const req = (await journal(dir)).at(-1)!;
  expect((req.data as any).origin).toBe("policy");
  expect((req.data as any).binding.outputs[0].path).toBe("artifacts/gated.md");
});
it("writes no request for a stage that declares no review", async () => {
  const { dir } = await completed("upstream");
  expect((await journal(dir)).map((e) => e.type)).not.toContain("approval-requested");
});
it("a failed request write is reported in the reason, and the stage is still awaiting_review", async () => {
  /* append fails only for approval-requested (copy fail-closed.test.ts's mechanism);
     outcome.status === "awaiting_review", reason matches /request .* could not be written/ */
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd studio/runtime && npx vitest run test/unit/execution/review.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

In `complete`, after `await sm.complete(instance);` and before building the return:

```ts
    // avg-2n7 deleted the loop that used to write this, so nothing told an
    // operator a stage was waiting for them (avg-qr4.3 notes, point 1). The
    // completion is already durable, so a request that fails to land is
    // reported, not treated as a failed stage: the gate then reads no record
    // and the manifest rule refuses dependents, which still fails closed.
    let requestNote: string | undefined;
    if (needsReview) {
      try {
        const hashed = await hashArtifacts(episodeDir, relative);
        const request = buildGateReview({
          stageId, decision: "requested", origin: "policy", actor: "runtime",
          binding: { planHash: planHashOf(stage.definition), outputs: hashed },
        });
        const asked = await appendJournalEvent(episodeDir, {
          type: "approval-requested", actor: "runtime", episode: ref, data: { ...request },
        });
        if (!asked) requestNote = `the review request for "${stageId}" could not be written to the journal`;
      } catch (e) {
        requestNote = `the review request for "${stageId}" could not be written: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
```

Move the `needsReview` declaration above this block, and append `requestNote` to the returned `reason` (`[base, requestNote].filter(Boolean).join("; ")`).

- [ ] **Step 4: Run to verify pass**

Run: `cd studio/runtime && npm test && cd ../gateway && npx vitest run`
Expected: PASS. Gateway tests asserting "the last journal event is stage-completed" for a reviewed stage need updating to expect the request after it.

- [ ] **Step 5: Commit**

```bash
git add studio
git commit -m "feat(runtime): a reviewed stage asks for its review when it completes"
```

---

### Task 9: Staleness is computed, recorded and reported

**Files:**
- Modify: `studio/runtime/src/execution/service.ts` (`review`, `complete`, `status`, `planRerun`)
- Modify: `studio/runtime/src/execution/types.ts` (`StageState` gains `"stale"`)
- Modify: `studio/runtime/src/cli.ts` (`cmdRerun` stops refusing `rerun-affected-downstream`)
- Test: `studio/runtime/test/unit/execution/staleness.test.ts` (new); `dry-run-rerun.test.ts` (the `MODE_UNSUPPORTED` case inverts)

**Interfaces:**
- Consumes: `propagate(pipeline, changedStageIds, episodeSlug): StalenessReport` from `../staleness/index.js`
- Produces:
  - `staleness-marked` event `data: { stageId: <trigger>, trigger: <trigger>, affected: [{ stageId, path: string[] }] }`
  - `StageState` includes `"stale"`; a completed stage is `stale` while a `staleness-marked` naming it is newer than both its last `stage-completed` and its last `approval-granted`
  - `planRerun(..., "rerun-affected-downstream", stages)` returns a plan; with no stages → `MODE_UNSUPPORTED` with message `/needs the stages that changed/`

- [ ] **Step 1: Check how the graph finds dependents**

`buildDependencyGraph` (`studio/runtime/src/staleness/graph.ts:18`) links stages by shared `produces`/`consumes` artifact labels, not `dependsOn`. Read it and confirm. The test pipeline must declare `consumes` for downstream stages; extend `helpers/review-chain.ts` so `gated` produces label `gated` and a new `downstream` stage consumes it.

- [ ] **Step 2: Write the failing tests**

```ts
it("a grant marks every stage downstream of it stale", async () => {
  // upstream → gated (review: human) → downstream ; downstream completed before the grant
  await svc.review(REF, "review-chain", "gated", { decision: "approved", principal: "operator" });
  const marked = (await journal(dir)).filter((e) => e.type === "staleness-marked").at(-1)!;
  expect((marked.data as any).trigger).toBe("gated");
  expect((marked.data as any).affected.map((a: any) => a.stageId)).toContain("downstream");
  const st = await svc.status(REF, "review-chain");
  expect(st.ok && st.value.stages.find((s) => s.stageId === "downstream")!.state).toBe("stale");
});
it("re-running the stale stage clears it", async () => {
  await svc.run(REF, "review-chain", { stage: "downstream" });
  const st = await svc.status(REF, "review-chain");
  expect(st.ok && st.value.stages.find((s) => s.stageId === "downstream")!.state).toBe("completed");
});
it("a rejection marks dependents stale too", async () => { /* same shape, decision rejected */ });
it("re-completing an approved stage marks its dependents stale", async () => { /* approve gated, run downstream, re-run gated → downstream stale */ });
it("a pending stage is never reported stale: it has nothing to be stale about", async () => { /* grant with downstream never run → downstream state pending */ });
it("writes no event when nothing is downstream", async () => { /* review of a leaf stage → no staleness-marked */ });
it("rerun-affected-downstream plans the stale set", async () => {
  const plan = await svc.planRerun(REF, "review-chain", "rerun-affected-downstream", ["gated"]);
  expect(plan.ok).toBe(true);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd studio/runtime && npx tsc -p . && npx vitest run test/unit/execution/staleness.test.ts test/unit/execution/dry-run-rerun.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

Private helper in `service.ts`:

```ts
  /**
   * Record which stages a change made stale (avg-33r's third, absorbed by
   * avg-qr4.3). The event says WHY a stage went stale; hash comparison still
   * decides WHETHER an approval stands. Neither replaces the other.
   *
   * Best-effort by design: a staleness record that fails to land loses an
   * explanation, not a safety property — the gate still re-hashes on read.
   */
  private async markStale(episodeDir: string, ref: EpisodeRef, pipeline: ResolvedPipeline, trigger: string): Promise<void> {
    const report = propagate(pipeline, [trigger], `${ref.channel}/${ref.series}/${ref.episode}`);
    const affected = report.stages
      .filter((s) => s.stale && s.stageId !== trigger)
      .map((s) => ({ stageId: s.stageId, path: s.reasons[0]?.path ?? [trigger, s.stageId] }));
    if (affected.length === 0) return;
    const written = await appendJournalEvent(episodeDir, {
      type: "staleness-marked", actor: "runtime", episode: ref,
      data: { stageId: trigger, trigger, affected },
    });
    if (!written) this.options.log?.(`staleness for "${trigger}" could not be recorded`);
  }
```

Call it:
- in `review()` after a successful write when `decision !== "requested"`;
- in `complete()` after the request block, when the journal (read at the top of `complete`) holds an `approval-granted` for `stageId`. That means a re-completion of an approved stage.

`status()`: before the per-stage loop compute

```ts
    // Index of the newest event of each kind per stage, for staleness.
    const lastIndex = (type: string, id: string) =>
      events.value.findLastIndex((e) => e.type === type && (e.data as { stageId?: string })?.stageId === id);
    const staleSince = (id: string) =>
      events.value.findLastIndex((e) => e.type === "staleness-marked" &&
        ((e.data as { affected?: { stageId: string }[] })?.affected ?? []).some((a) => a.stageId === id));
```

and in the completed branch, before the review lookup:

```ts
        const marked = staleSince(stage.definition.id);
        if (marked > lastIndex("stage-completed", stage.definition.id) &&
            marked > lastIndex("approval-granted", stage.definition.id)) {
          state = "stale";
          stateReason = `"${stage.definition.id}" is stale: an upstream stage changed after it ran`;
        } else { /* the Task 6 review branch */ }
```

(`findLastIndex` needs `lib: es2023` in the runtime tsconfig. If it is missing, write a small reverse loop instead of changing the tsconfig.)

`planRerun`: replace `planRerun(undefined, ...)` with a report when the mode is `rerun-affected-downstream`:

```ts
    let report;
    if (mode === "rerun-affected-downstream") {
      if (selectedStages.length === 0) {
        return err({ code: "MODE_UNSUPPORTED", message: "rerun-affected-downstream needs the stages that changed (--stages a,b)" });
      }
      report = propagate(resolved.value, selectedStages, episodeSlug);
    }
```

Pass `report` as `planRerun`'s first argument, and delete the now-stale comment block about `MODE_UNSUPPORTED` in the catch. Keep the catch for anything else the planner throws.

`cli.ts` `cmdRerun`: delete the guard that refuses `rerun-affected-downstream` by name. `--stages` already flows into `selectedStages`.

Add `"stale"` to `StageState` and to the web's `StageState` union in `studio/web/src/contracts/gateway.ts` (the web styling comes in Task 11).

- [ ] **Step 5: Run to verify pass**

Run: `cd studio/runtime && npm test && cd ../gateway && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio
git commit -m "feat(runtime): a decision marks what depends on it stale, and status says so"
```

---

### Task 10: Pi asks; it does not approve

**Files:**
- Modify: `studio/agent/src/pipeline-tools.ts:365-400` (`pva_approve` → `pva_request_approval`)
- Modify: `studio/agent/src/slash-commands.ts:89-115` (`/approve` → `/request-approval`)
- Modify: `studio/gateway/src/rpc/intent-router.ts:131-145` (`approve` intent refuses)
- Modify: any Pi skill or prompt text that names `pva_approve`: `grep -rn "pva_approve" .pi skills studio docs`
- Test: `studio/agent/test/pipeline-tools.test.ts` (or wherever `pva_*` wire calls are pinned: `grep -rln "pva_claim_stage" studio/agent/test`), `studio/gateway/test/intent-router.test.ts`, new `studio/agent/test/no-operator-key.test.ts`

**Interfaces:**
- Consumes: gateway `POST .../approve` (Task 5), which downgrades an agent to a request
- Produces: tool `pva_request_approval` with the same parameters minus `justification`, plus optional `note`

- [ ] **Step 1: Write the failing tests**

Pin the tool the way `ee8b5e8` pinned `pva_claim_stage`:

```ts
it("pva_request_approval posts to the approve route and reports a request, not a grant", async () => {
  // fake client returns { ok: true, outcome: { status: "requested", reason: "…operator must approve…" } }
  // assert the fetch URL ends with /stages/script/approve and the tool text contains "requested"
});
it("there is no pva_approve tool", () => {
  expect(registeredToolNames()).not.toContain("pva_approve");
});
```

`no-operator-key.test.ts`, a guard against the one regression that would undo this whole design:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
it("nothing in the agent's source names the operator key", () => {
  const src = join(__dirname, "..", "src");
  for (const f of readdirSync(src, { recursive: true }) as string[]) {
    if (!/\.(ts|mjs|js)$/.test(f)) continue;
    const text = readFileSync(join(src, f), "utf-8");
    expect(text, f).not.toMatch(/operator-key|AVG_OPERATOR_KEY_FILE/);
  }
});
```

Intent router:

```ts
it("the approve intent does not reach Pi, and names the route that decides", async () => {
  const result = await handleIntent({ intent: "approve", episodeSlug: "c/s/e", stageId: "script", payload: {} }, mgr, bus);
  expect(result.status).toBe("rejected");
  expect(result.action).toBe("use-approve-route");
  expect(sessionRequest).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd studio/agent && npx vitest run && cd ../gateway && npx vitest run test/intent-router.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Tool:

```ts
  // --- Tool: pva_request_approval ----------------------------------------
  // Pi may ask for a review; it cannot grant one (avg-qr4.3). The gateway
  // resolves Pi's token to the agent principal, and the service turns an
  // agent's approval of a human gate into a request — so even calling the
  // approve route cannot mint a human approval. This tool says so up front
  // rather than letting Pi believe it approved something.
  pi.registerTool({
    name: "pva_request_approval",
    label: "Request Approval",
    description:
      "Ask the operator to review a completed stage. This does NOT approve it: a human gate " +
      "is satisfied only by the operator. Stop and tell the user what is waiting for them.",
    parameters: Type.Object({
      channel: Type.String({ description: "Channel slug" }),
      series: Type.String({ description: "Series slug" }),
      episode: Type.String({ description: "Episode slug" }),
      stageId: Type.String({ description: "Stage ID to request review for" }),
    }),
    async execute(_toolCallId, params) {
      /* same fetch as before to .../approve with body {}; render result.outcome.status and reason */
    },
  });
```

Slash command: rename to `request-approval`, keep the usage parsing, and replace the message:

```ts
      pi.sendUserMessage(
        `Request operator review of stage "${stageId}" for episode ${path} with pva_request_approval, ` +
        `then stop and tell the user it is waiting for them. You cannot approve it yourself.`,
      );
```

Intent router `approve` case:

```ts
      case "approve": {
        // Not forwarded to Pi: Pi cannot approve (avg-qr4.3), and this router
        // holds no execution service to record a decision itself. The studio
        // calls the stage approve route directly with the operator credential.
        return {
          success: false,
          correlationId: ctx.correlationId,
          action: "use-approve-route",
          data: { route: `/api/channels/…/stages/${ctx.stageId}/approve` },
          status: "rejected",
        };
      }
```

(Build the real route string from `ctx.episodeSlug`.)

Update every text mention of `pva_approve` found by the grep in Files.

- [ ] **Step 4: Run to verify pass**

Run: `cd studio/agent && npx vitest run && cd ../gateway && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio .pi skills docs
git commit -m "feat(agent): Pi requests approval and can no longer claim to grant it"
```

---

### Task 11: The studio holds the operator credential, can reject, and shows stale

**Files:**
- Modify: `studio/web/vite.config.ts` (define `__OPERATOR_KEY__` from `../gateway/.operator-key` in `serve`, `VITE_OPERATOR_KEY` in build)
- Modify: `studio/web/src/lib/gateway.svelte.ts:16-26` (credential choice), the `declare const __GATEWAY_TOKEN__` site (add `__OPERATOR_KEY__`)
- Modify: `studio/web/src/lib/production-store.svelte.ts` (`rejectStage`, `actionsFor`)
- Modify: `studio/web/src/components/episode/ProductionPanel.svelte`, `StageDetail.svelte` (Reject action with a note; `stale` style and label)
- Test: `studio/web/test/unit/production-actions.test.ts`, new `studio/web/test/unit/gateway-credential.test.ts`

**Interfaces:**
- Consumes: `/approve`, `/reject` routes (Task 5); `stale` state (Task 9)
- Produces: `actionsFor("awaiting_review") → ["approve", "reject"]`, `actionsFor("stale") → ["run"]`, `ProductionStore.rejectStage(stageId, note)`; `credentialFor(storage, operatorKey, gatewayToken): string`

- [ ] **Step 1: Write the failing tests**

```ts
// production-actions.test.ts
it("offers approve and reject for a stage awaiting review", () => {
  expect(actionsFor("awaiting_review")).toEqual(["approve", "reject"]);
});
it("offers run for a stale stage", () => {
  expect(actionsFor("stale")).toEqual(["run"]);
});
it("rejectStage posts the note to the reject route", async () => { /* stub fetchJSON, assert path and body { note } */ });

// gateway-credential.test.ts
import { credentialFor } from "../../src/lib/gateway.svelte";
it("prefers a stored operator key", () =>
  expect(credentialFor({ getItem: (k) => (k === "vs-operator-key" ? "op" : null) }, "", "tok")).toBe("op"));
it("uses the dev operator key when none is stored", () =>
  expect(credentialFor({ getItem: () => null }, "op-dev", "tok")).toBe("op-dev"));
it("falls back to the agent token: approvals then become requests, which is the safe failure", () =>
  expect(credentialFor({ getItem: () => null }, "", "tok")).toBe("tok"));
```

- [ ] **Step 2: Run to verify failure**

Run: `cd studio/web && bun x vitest run test/unit/production-actions.test.ts test/unit/gateway-credential.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`gateway.svelte.ts`:

```ts
/**
 * Which credential the studio presents (avg-qr4.3). The operator key makes
 * this browser the operator, so its approvals are signed human decisions.
 * Without it the studio still works on the agent token, and an approval
 * becomes a request, which fails closed.
 */
export function credentialFor(
  storage: Pick<Storage, "getItem">, operatorKey: string, gatewayToken: string,
): string {
  return storage.getItem("vs-operator-key") || operatorKey || storage.getItem("vs-gateway-token") || gatewayToken;
}
```

and in `getGatewayClient`: `const token = credentialFor(localStorage, __OPERATOR_KEY__, __GATEWAY_TOKEN__);`.

`vite.config.ts`: mirror `devGatewayToken()` as `devOperatorKey()` reading `../gateway/.operator-key`, and define `__OPERATOR_KEY__` as `command === "serve" ? devOperatorKey() : (process.env.VITE_OPERATOR_KEY ?? "")`.

`production-store.svelte.ts`:

```ts
export function actionsFor(state: string): Array<"run" | "approve" | "reject"> {
  switch (state) {
    case "runnable":
    case "completed":
    case "failed":
    case "stale":
      return ["run"];
    case "awaiting_review":
      return ["approve", "reject"];
    default:
      return [];
  }
}

  /** Reject a stage's output. The note is what the next attempt has to fix. */
  rejectStage(stageId: string, note: string): Promise<void> {
    return this.#act(stageId, `/stages/${encodeURIComponent(stageId)}/reject`, { note });
  }
```

Components: render a Reject button beside Approve. Clicking it opens an inline text field (no browser `prompt()`). Submit is disabled while the note is empty. Add `.s-stale` styling next to `.s-awaiting_review` in `ProductionPanel.svelte:234` and a "Stale — re-run" label in `StageDetail.svelte:45`. When an outcome comes back `requested`, show its `reason` as `lastMessage` so a browser on the agent token sees why nothing was approved.

- [ ] **Step 4: Run to verify pass**

Run: `cd studio/web && bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/web
git commit -m "feat(web): the studio approves as the operator, can reject, and shows stale stages"
```

---

### Task 12: The acceptance line, docs, and follow-ups

**Files:**
- Test: `studio/gateway/test/approval-acceptance.test.ts` (new)
- Modify: `docs/running.md` and `docs/install.md` (operator key: where it lives, who holds it, what headless means, how to rotate), `docs/harness-review.md` (mark the P0 approval section as addressed, linking the spec)
- Beads: close `avg-qr4.3`; update `avg-33r`; file follow-ups

- [ ] **Step 1: Write the acceptance test**

Through the real `createGateway` with a temp config whose `token.file` and `operatorKey.file` point into a temp dir (so the test never writes into `studio/gateway/`), the real auth hook, and `inject`:

```ts
it("script → operator approves → compose may run; the same approval with Pi's token stops at requested", async () => {
  // 1. complete `script`'s dependencies and `script` itself with the claim/complete routes,
  //    as the operator (Bearer operatorKey), since script is autopilot: false.
  // 2. POST .../stages/script/approve with Bearer agentToken → outcome.status "requested".
  // 3. POST .../stages/<first stage depending on script>/execute with Bearer agentToken →
  //    blocked, reason mentions script's review.
  // 4. POST .../stages/script/approve with Bearer operatorKey → outcome.status "approved".
  // 5. The same execute → no longer blocked by script's review (it may block on its own
  //    autopilot or dispatcher; assert the reason does not mention script).
  // 6. Append a forged approval-granted for script (origin human, no signature) with
  //    appendJournalEvent → status reports script awaiting_review with /unsigned/.
});
```

Use `narrated-illustrated-video`. Read its manifest for `script`'s dependencies and dependents before writing the steps.

- [ ] **Step 2: Run it**

Run: `cd studio/gateway && npx vitest run test/approval-acceptance.test.ts`
Expected: PASS. If it fails, the failure is a real gap. Fix it in the task that owns the behavior and do not loosen this test.

- [ ] **Step 3: Docs**

`docs/running.md`, a new section "The operator key":
- the gateway writes `studio/gateway/.operator-key` (0600) beside `.gateway-token` on first start
- the studio (in dev) and `vpr` read it; Pi is given only the gateway token
- without it `vpr approve` records a request and exits non-zero
- rotation: stop the gateway, delete the file, start the gateway. Every existing human approval then reads `unsigned` or `does not verify` and must be re-granted. That is intended.
- the limit: anything running as your user that reads the file is the operator (see avg-qr4.8).

Run `npm run docs:check` at the root. VitePress breaks on bare `<id>`-style angle brackets outside code spans (see `fea5860`), so put paths like `<channel>` in backticks.

- [ ] **Step 4: Full check**

Run: `npm run check` at the repo root.
Expected: PASS. Fix anything it finds before continuing.

- [ ] **Step 5: Beads**

```bash
bd close avg-qr4.3 --reason "Signed, plan-bound receipts; operator principal; attended claims; approval-requested/rejected; spec docs/superpowers/specs/2026-09-24-authenticated-revision-bound-approval-design.md"
bd update avg-33r --notes "Staleness third landed with avg-qr4.3 (staleness-marked, status stale, rerun-affected-downstream). Candidates and atomic take selection remain; they belong with avg-qr4.6."
bd create "Bind approval receipts to resolved settings" -t task -p 2 --parent avg-qr4 --description "avg-qr4.3 binds receipts to planHash and artifact hashes. Settings are not resolved by the execution service yet, so a settings change does not invalidate an approval. Bind once the service resolves settings."
bd create "Document and tool operator key rotation" -t task -p 3 --parent avg-qr4 --description "Rotating .operator-key invalidates every human receipt (correct). Needs a vpr command or doc'd procedure that lists what must be re-approved."
```

Run `bd ready` afterwards to confirm qr4.4 and qr4.7 are unblocked if qr4.2 is now closeable (close `avg-qr4.2` too if `avg-33r` is re-parented or deferred with a rationale; ask the user which).

- [ ] **Step 6: Commit**

```bash
git add studio docs .beads
git commit -m "test: the harness review's approval acceptance line, end to end"
```
