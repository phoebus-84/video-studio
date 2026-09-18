# Durable Execution State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an episode's execution state — which stages ran, how many times, who held them — recoverable after a crash, by deriving it from the append-only journal.

**Architecture:** Two parts. First `avg-i1x`: make the journal writer conform to `journal-event.schema.json` and add validation, because the journal is about to become the sole authority for whether a stage ran. Then `avg-pm8`: a schema for execution-event payloads, a pure `deriveExecutionState` replay function, and a real filesystem `Lock` — because a log can record that a lease was granted but cannot arbitrate who won.

**Tech Stack:** JavaScript ESM `.mjs` + `.d.mts` in `@studio/contracts` (`node --test`), TypeScript in `@studio/runtime` (vitest), JSON Schema 2020-12 with ajv.

**Spec:** `docs/superpowers/specs/2026-09-16-durable-execution-state-design.md`

## Global Constraints

- **Issues:** `avg-i1x` (Tasks 1–2), then `avg-pm8` (Tasks 3–6). Branch `qr4.2a-durable-execution-state` exists and holds the spec commit.
- **There is no legacy journal data.** Every `events.jsonl` under `library/` is 0 lines — verified. Do NOT write back-compat readers, dual-shape tolerance, or a migration. If you find yourself adding `data ?? detail`, stop: that is a fallback for data that does not exist.
- **The schema is the target shape, not negotiable.** `JournalEvent` requires `apiVersion`, `kind`, `id`, `episodeRef`, `at`, `actor`, `type`, `data`, with `additionalProperties: false`. `id` must match `^evt_[0-9A-HJKMNP-TV-Z]{26}$` — that character class is exactly Crockford base32 (no I, L, O, U), i.e. a ULID.
- **No new runtime dependencies.** `@studio/contracts` has `ajv` as a **devDependency only**, and the gateway consumes `journal.mjs` at runtime without ajv. Runtime validation is therefore hand-rolled and structural; ajv is used only in contracts tests. There is no `ulid` package and none may be added — write the generator.
- **Contracts uses `node --test`**, tests are `studio/contracts/test/*.test.mjs`, run with `npm test -w @studio/contracts`. Runtime and gateway use vitest.
- **Every `.mjs` in `studio/contracts/src/` has a companion `.d.mts`.** The gateway and runtime are TypeScript and import these modules directly.
- **`studio/runtime` has no `typecheck` script.** Use `npx tsc --noEmit -p studio/runtime/tsconfig.json`. The gateway does have one: `npm run typecheck -w @studio/gateway`.
- **Commit after every task.**

---

## File Structure

| file | responsibility |
|---|---|
| `studio/contracts/src/journal.mjs` | **modify** — emit the schema's envelope; ULID ids; structural validation; strict read mode |
| `studio/contracts/src/journal.d.mts` | **modify** — types follow the new shape |
| `studio/contracts/src/gate-review.mjs` | **modify** — `deriveGateState` reads `data`, not `detail` |
| `studio/contracts/test/journal.test.mjs` | **modify** — new shape, plus a real-output-vs-schema conformance test |
| `studio/gateway/src/runtime/executor.ts` | **modify** — `data` at call sites; delete the redundant `attempt-recorded` write |
| `studio/gateway/src/workspace/filesystem-service.ts` | **modify** — journal route reader |
| `studio/runtime/src/cli.ts` | **modify** — `cmdApprove`'s write |
| `studio/agent/src/pipeline-tools.ts` | **modify** — `pva_journal` tool reader |
| `studio/contracts/schemas/v1alpha1/execution-event.schema.json` | **new** — the five execution payloads |
| `studio/contracts/fixtures/execution-event/{valid,invalid}/*.json` | **new** |
| `studio/contracts/scripts/check-execution-event-fixtures.mjs` | **new** |
| `studio/contracts/src/execution-state.mjs` + `.d.mts` | **new** — `deriveExecutionState`, lease liveness |
| `studio/contracts/test/execution-state.test.mjs` | **new** |
| `studio/runtime/src/ports/file-lock.ts` | **new** — filesystem `Lock` implementation |
| `studio/runtime/test/unit/ports/file-lock.test.ts` | **new** |

---

### Task 1: The journal writer conforms to its schema

**Files:**
- Modify: `studio/contracts/src/journal.mjs`
- Modify: `studio/contracts/src/journal.d.mts`
- Modify: `studio/contracts/src/gate-review.mjs` (`deriveGateState` field access)
- Modify: `studio/contracts/test/journal.test.mjs`
- Modify: `studio/contracts/test/gate-review.test.mjs` (its event helper builds journal events)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `buildJournalEvent({ type, actor, episode, stageId, data, at })` → an event with `{ apiVersion, kind, id, episodeRef, at, actor, type, data }`. Note the **parameter** stays `episode` (callers pass an `EpisodeRef`) while the **field** is `episodeRef`; `stageId` moves inside `data`.
  - `parseJournal(contents, { type, limit, strict })` — `strict: true` throws on a malformed line instead of skipping it.
  - `ulid()` — exported for tests; `evt_` prefixing happens inside `buildJournalEvent`.
  - Task 2 updates every call site to pass `data` instead of `detail`.

- [ ] **Step 1: Write the failing tests**

Replace the body of `studio/contracts/test/journal.test.mjs`'s existing describe with these, keeping its imports and `beforeEach`/`afterEach`:

```js
  it("produces an event that validates against journal-event.schema.json", async () => {
    // This is the test whose absence caused avg-i1x. The fixtures always
    // conformed; the writer never did, and nothing compared them.
    const { readFileSync } = await import("node:fs");
    const Ajv2020 = (await import("ajv/dist/2020.js")).default;
    const addFormats = (await import("ajv-formats")).default;

    const schema = JSON.parse(
      readFileSync(new URL("../schemas/v1alpha1/journal-event.schema.json", import.meta.url), "utf-8"),
    );
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    ajv.addSchema(schema);
    const validate = ajv.getSchema(`${schema.$id}#/$defs/JournalEvent`);

    const event = buildJournalEvent({
      type: "stage-started",
      actor: "runtime",
      episode: ref,
      data: { stageId: "illustrations", leaseId: "lease-1", attemptNumber: 1 },
    });

    const valid = validate(event);
    assert.equal(valid, true, JSON.stringify(validate.errors));
  });

  it("stamps the envelope the schema requires", () => {
    const event = buildJournalEvent({
      type: "stage-started", actor: "runtime", episode: ref, data: { stageId: "s" },
    });
    assert.equal(event.apiVersion, "studio.video/v1alpha1");
    assert.equal(event.kind, "JournalEvent");
    assert.match(event.id, /^evt_[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.deepEqual(event.episodeRef, ref);
    assert.equal(event.data.stageId, "s");
    assert.equal(event.eventId, undefined);
    assert.equal(event.detail, undefined);
    assert.equal(event.episode, undefined);
  });

  it("generates ids that sort by creation time", () => {
    // Explicit timestamps, not three calls in a row: within a single
    // millisecond the time prefix is identical and the random suffix decides
    // the order, so a tight loop would make this assertion flap.
    const ids = [ulid(1_000), ulid(2_000), ulid(3_000)];
    assert.deepEqual([...ids].sort(), ids);
    assert.equal(ulid(1_000).slice(0, 10), ulid(1_000).slice(0, 10));
  });

  it("rejects an event whose data is not an object", () => {
    assert.throws(
      () => buildJournalEvent({ type: "stage-started", actor: "runtime", episode: ref, data: "nope" }),
      /data/,
    );
  });

  it("still rejects an unknown type or actor", () => {
    assert.throws(() => buildJournalEvent({ type: "nope", actor: "runtime", episode: ref, data: {} }), /type/);
    assert.throws(() => buildJournalEvent({ type: "stage-started", actor: "nope", episode: ref, data: {} }), /actor/);
  });

  it("skips a malformed line by default, but surfaces it in strict mode", () => {
    const good = JSON.stringify(buildJournalEvent({
      type: "stage-started", actor: "runtime", episode: ref, data: { stageId: "s" },
    }));
    const contents = `${good}\n{ not json\n`;

    // The narrative route must not let one bad record hide the rest.
    assert.equal(parseJournal(contents).length, 1);
    // Execution state derived from the log must not silently lose an attempt.
    assert.throws(() => parseJournal(contents, { strict: true }), /line 2/);
  });
```

Update the import at the top of the file to `import { appendJournalEvent, buildJournalEvent, parseJournal, ulid, JOURNAL_RELATIVE_PATH } from "../src/journal.mjs";` and add `const ref = { channel: "video-storici", series: "roma-pills", episode: "giulio-cesare" };` if the existing `ref` is scoped elsewhere.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @studio/contracts`
Expected: FAIL — `ulid` is not exported, and the writer emits `eventId`/`episode`/`detail`.

- [ ] **Step 3: Write the ULID generator**

Add to `studio/contracts/src/journal.mjs`, after the imports:

```js
import { randomBytes } from "node:crypto";

/** Crockford base32 — the schema's id pattern is exactly this alphabet. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A ULID: 48 bits of timestamp then 80 bits of randomness, Crockford base32.
 *
 * Written here rather than taken as a dependency: it is twenty lines, and
 * @studio/contracts is imported at runtime by packages that carry no ajv and
 * should not grow a dependency tree for an id.
 *
 * Time-ordered, so a journal sorts by id as well as by position — which is what
 * makes an id useful for ordering rather than only for identity.
 */
export function ulid(now = Date.now()) {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let random = "";
  for (let i = 0; i < 16; i++) {
    random += CROCKFORD[bytes[i] % 32];
  }
  return time + random;
}
```

- [ ] **Step 4: Rewrite `buildJournalEvent` to the schema's shape**

Replace the existing `buildJournalEvent` body:

```js
/** The envelope every schema in this package stamps on a top-level document. */
const API_VERSION = "studio.video/v1alpha1";

export function buildJournalEvent({ type, actor, episode, stageId, data, at }) {
  if (!JOURNAL_EVENTS.includes(type)) {
    throw new Error(`Unknown journal event type: ${type}`);
  }
  if (!JOURNAL_ACTORS.includes(actor)) {
    throw new Error(`Unknown journal actor: ${actor}`);
  }
  if (!episode?.channel || !episode?.series || !episode?.episode) {
    throw new Error("A journal event must name its channel, series and episode");
  }
  if (data !== undefined && (typeof data !== "object" || data === null || Array.isArray(data))) {
    throw new Error("A journal event's data must be an object");
  }

  // stageId used to sit at the top level, which additionalProperties: false
  // rejects. It belongs in the payload, where every reader now looks for it.
  const payload = { ...(data ?? {}) };
  if (stageId !== undefined && payload.stageId === undefined) payload.stageId = stageId;

  return {
    apiVersion: API_VERSION,
    kind: "JournalEvent",
    id: `evt_${ulid()}`,
    episodeRef: {
      channel: episode.channel,
      series: episode.series,
      episode: episode.episode,
    },
    at: at ?? new Date().toISOString(),
    actor,
    type,
    data: payload,
  };
}
```

Keep `appendJournalEvent` as it is — it already builds then appends, and already returns `null` rather than throwing, which must not change: a stage that ran must not be reported failed because its bookkeeping could not be written.

- [ ] **Step 5: Add strict mode to `parseJournal`**

Replace the existing `parseJournal`:

```js
export function parseJournal(contents, { type, limit, strict = false } = {}) {
  const events = [];
  const lines = contents.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      // Lenient by default: the journal is a narrative, and one bad record must
      // not hide the rest. Strict for callers deriving state from it, where a
      // skipped line is a silently forgotten attempt rather than a missing note.
      if (strict) {
        throw new Error(`Malformed journal record at line ${i + 1}`);
      }
      continue;
    }
    if (type && event.type !== type) continue;
    events.push(event);
  }
  return typeof limit === "number" && limit >= 0 ? events.slice(-limit) : events;
}
```

- [ ] **Step 6: Update `deriveGateState`'s field access**

In `studio/contracts/src/gate-review.mjs`, the filter currently reads
`(event.detail?.stageId ?? event.stageId) === stageId`. Replace with:

```js
  const mine = events.filter((event) => event.data?.stageId === stageId);
```

and replace every other `latest.detail?.` with `latest.data?.` in that function.

- [ ] **Step 7: Update `gate-review.test.mjs`'s event helper**

Its `evt()` helper builds events by hand with `detail`. Change it to the new shape:

```js
    const evt = (type, data, actor = "human") => ({
      apiVersion: "studio.video/v1alpha1",
      kind: "JournalEvent",
      id: `evt_${"0".repeat(26)}`,
      episodeRef: { channel: "c", series: "s", episode: "e" },
      at: new Date().toISOString(),
      actor,
      type,
      data,
    });
```

Its call sites already pass an object containing `stageId`, so they need no change.

- [ ] **Step 8: Update `journal.d.mts`**

Replace the event interface with:

```ts
export interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

export interface JournalEvent {
  apiVersion: "studio.video/v1alpha1";
  kind: "JournalEvent";
  /** `evt_` followed by a 26-character Crockford base32 ULID. */
  id: string;
  episodeRef: EpisodeRef;
  at: string;
  actor: JournalActor;
  type: JournalEventType;
  data: Record<string, unknown>;
}

export declare function ulid(now?: number): string;

export declare function buildJournalEvent(input: {
  type: JournalEventType;
  actor: JournalActor;
  episode: EpisodeRef;
  stageId?: string;
  data?: Record<string, unknown>;
  at?: string;
}): JournalEvent;

export declare function parseJournal(
  contents: string,
  options?: { type?: JournalEventType; limit?: number; strict?: boolean },
): JournalEvent[];
```

Keep the existing `JournalActor` / `JournalEventType` unions and `appendJournalEvent` declaration, changing the latter's input to match `buildJournalEvent`'s.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test -w @studio/contracts`
Expected: PASS. If the conformance test fails, read its ajv errors — they name the exact field the writer still gets wrong.

- [ ] **Step 10: Commit**

```bash
git add studio/contracts/src/journal.mjs studio/contracts/src/journal.d.mts \
        studio/contracts/src/gate-review.mjs studio/contracts/test/journal.test.mjs \
        studio/contracts/test/gate-review.test.mjs
git commit -m "contracts: make the journal writer conform to its own schema

journal.mjs named journal-event.schema.json as its contract and never
produced a conforming event: eventId for id, episode for episodeRef,
detail for data, stageId at the top level, and no apiVersion/kind
envelope against additionalProperties: false.

Nothing caught it because only the hand-written fixtures were ever
validated. The new conformance test runs real writer output through the
schema, which is the check whose absence let the two drift.

parseJournal gains a strict mode: skipping a malformed line is right for
a narrative and wrong for a log that execution state is derived from."
```

---

### Task 2: Every journal call site speaks the new shape

**Files:**
- Modify: `studio/gateway/src/runtime/executor.ts` (5 `appendJournalEvent` calls, 1 `parseJournal`, and the deletion below)
- Modify: `studio/gateway/src/workspace/filesystem-service.ts:451`
- Modify: `studio/runtime/src/cli.ts:431`
- Modify: `studio/agent/src/pipeline-tools.ts` (`pva_journal`)
- Modify: `studio/gateway/test/gate-enforcement.test.ts`, `studio/gateway/test/captions-journal.test.ts`

**Interfaces:**
- Consumes: `buildJournalEvent`/`appendJournalEvent` taking `data` (Task 1).
- Produces: a tree where no code reads `.detail`, `.eventId`, or `.episode` on a journal event.

- [ ] **Step 1: Find every call site**

Run:

```bash
grep -rn 'detail:\|\.detail\b\|eventId\|event\.episode\b' --include='*.ts' --include='*.mjs' studio/*/src studio/*/test | grep -v node_modules
```

Expected: hits in the four source files and two test files listed above. Work through them; the list in this step is the definition of done.

- [ ] **Step 2: Update the writers**

In `studio/gateway/src/runtime/executor.ts`, every `appendJournalEvent` call currently passes `stageId` at the top level and `detail: {...}`. Change each to pass the payload as `data`, folding `stageId` into it. For example the `stage-started` call becomes:

```ts
    await appendJournalEvent(episodeDir, {
      type: "stage-started", actor: "runtime", episode: ref,
      data: { stageId },
    });
```

and the `stage-failed` call becomes:

```ts
      await appendJournalEvent(episodeDir, {
        type: "stage-failed", actor: "runtime", episode: ref,
        data: { stageId, durationMs: Date.now() - stageStart, error: message },
      });
```

Apply the same transformation to `stage-completed`, and to the `approval-requested` written by `requestReview` — whose `data` is the gate-review record, with `stageId` already inside it, so it needs only `detail:` → `data:`.

In `studio/runtime/src/cli.ts:431`, `cmdApprove`'s `appendJournalEvent` gets the same treatment.

- [ ] **Step 3: Delete the redundant `attempt-recorded` write**

In `studio/gateway/src/runtime/executor.ts`, delete the `appendJournalEvent` call with `type: "attempt-recorded"` entirely (the one whose payload is `{ durationMs, outputs }`, in the `review !== "none"` branch).

It carries no `leaseId` and no `attemptNumber`, because the gateway takes no leases — so once Task 3 makes `attempt-recorded` lease-bound it would be invalid. It is already redundant: the `approval-requested` emitted beside it by `requestReview` records the same outputs, with hashes, and is what the review path actually reads. Only `durationMs` is lost and nothing consumes it.

Do NOT weaken the execution-event schema to accommodate it.

- [ ] **Step 4: Update the readers**

`studio/gateway/src/workspace/filesystem-service.ts:451` and the `readJournal` helper in `executor.ts` call `parseJournal` and pass events on; they need no field changes unless they index into `.detail`. Check with the grep from Step 1.

`studio/agent/src/pipeline-tools.ts`'s `pva_journal` tool formats events for the agent — update any `.detail` access to `.data`, and any `.episode` to `.episodeRef`.

- [ ] **Step 5: Update the gateway tests**

`studio/gateway/test/gate-enforcement.test.ts` asserts on `requested[0]!.detail.stageId` and `detail.outputs[0].sha256`, and builds `approval-granted` events by hand in the dependency-gate tests. Change every `detail` to `data`. `captions-journal.test.ts` appends events directly — update its `detail:` to `data:`.

- [ ] **Step 6: Run everything**

Run:

```bash
npm test -w @studio/contracts && npm test -w @studio/runtime && npm test -w @studio/gateway
npm run typecheck -w @studio/gateway && npx tsc --noEmit -p studio/runtime/tsconfig.json
```

Expected: all pass, zero failures. The gateway suite was 278 passing before this task and should be 278 after minus nothing — deleting the `attempt-recorded` write removes no test, because no test asserted on it. If a test does assert on it, that test is asserting the redundancy; delete the assertion, not the deletion.

- [ ] **Step 7: Commit**

```bash
git add studio/gateway/src studio/runtime/src/cli.ts studio/agent/src/pipeline-tools.ts studio/gateway/test
git commit -m "studio: every journal call site speaks the schema's shape

Payloads move from detail to data, stageId moves inside the payload, and
the gateway's redundant attempt-recorded write is deleted: it carried no
leaseId or attemptNumber because the gateway takes no leases, and the
approval-requested beside it already records the same outputs with
hashes."
```

---

### Task 3: The execution-event payload schema

**Files:**
- Create: `studio/contracts/schemas/v1alpha1/execution-event.schema.json`
- Create: `studio/contracts/fixtures/execution-event/valid/stage-leased.json`
- Create: `studio/contracts/fixtures/execution-event/valid/stage-completed.json`
- Create: `studio/contracts/fixtures/execution-event/invalid/leased-without-lease.json`
- Create: `studio/contracts/fixtures/execution-event/invalid/negative-attempt.json`
- Create: `studio/contracts/scripts/check-execution-event-fixtures.mjs`
- Modify: `studio/contracts/package.json` (`check:schemas`)
- Generated: `studio/contracts/bindings/ts/execution-event.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `$id` `https://video.studio/schemas/v1alpha1/execution-event.schema.json`, `$defs` `StageLeased`, `StageStarted`, `StageCompleted`, `StageFailed`, `AttemptRecorded`. Task 4 reads these payload shapes.

- [ ] **Step 1: Write the schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://video.studio/schemas/v1alpha1/execution-event.schema.json",
  "title": "Execution event payloads",
  "description": "The `data` payloads of the journal events that execution state is replayed from. Every one carries leaseId and attemptNumber: a stage attempted three times produces three interleaved runs of events, and without both a reader cannot tell which stage-failed closes which stage-started.",
  "$defs": {
    "StageLeased": {
      "type": "object",
      "additionalProperties": false,
      "required": ["stageId", "leaseId", "attemptNumber", "ttlMs", "expiresAt", "holder"],
      "properties": {
        "stageId": { "type": "string", "minLength": 1 },
        "leaseId": { "type": "string", "minLength": 1 },
        "attemptNumber": { "type": "integer", "minimum": 1 },
        "ttlMs": { "type": "integer", "minimum": 1 },
        "expiresAt": { "type": "string", "format": "date-time" },
        "holder": {
          "type": "string",
          "minLength": 1,
          "description": "Who took the lease, so an expired one reports as held by X until T rather than as an anonymous block."
        }
      }
    },
    "StageStarted": {
      "type": "object",
      "additionalProperties": false,
      "required": ["stageId", "leaseId", "attemptNumber"],
      "properties": {
        "stageId": { "type": "string", "minLength": 1 },
        "leaseId": { "type": "string", "minLength": 1 },
        "attemptNumber": { "type": "integer", "minimum": 1 }
      }
    },
    "StageCompleted": {
      "type": "object",
      "additionalProperties": false,
      "required": ["stageId", "leaseId", "attemptNumber", "outputs"],
      "properties": {
        "stageId": { "type": "string", "minLength": 1 },
        "leaseId": { "type": "string", "minLength": 1 },
        "attemptNumber": { "type": "integer", "minimum": 1 },
        "outputs": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "durationMs": { "type": "integer", "minimum": 0 }
      }
    },
    "StageFailed": {
      "type": "object",
      "additionalProperties": false,
      "required": ["stageId", "leaseId", "attemptNumber", "error"],
      "properties": {
        "stageId": { "type": "string", "minLength": 1 },
        "leaseId": { "type": "string", "minLength": 1 },
        "attemptNumber": { "type": "integer", "minimum": 1 },
        "error": { "type": "string", "minLength": 1 },
        "retryable": { "type": "boolean" },
        "durationMs": { "type": "integer", "minimum": 0 }
      }
    },
    "AttemptRecorded": {
      "type": "object",
      "additionalProperties": false,
      "required": ["stageId", "leaseId", "attemptNumber", "outcome"],
      "properties": {
        "stageId": { "type": "string", "minLength": 1 },
        "leaseId": { "type": "string", "minLength": 1 },
        "attemptNumber": { "type": "integer", "minimum": 1 },
        "outcome": { "enum": ["success", "failure", "timeout"] },
        "outputs": { "type": "array", "items": { "type": "string", "minLength": 1 } }
      }
    }
  }
}
```

- [ ] **Step 2: Write the fixtures**

`fixtures/execution-event/valid/stage-leased.json`:

```json
{
  "stageId": "illustrations",
  "leaseId": "lease_01HZY8K3M4N5P6Q7R8S9T0V1W2",
  "attemptNumber": 1,
  "ttlMs": 300000,
  "expiresAt": "2026-09-16T12:05:00Z",
  "holder": "gateway/pid-4821"
}
```

`fixtures/execution-event/valid/stage-completed.json`:

```json
{
  "stageId": "illustrations",
  "leaseId": "lease_01HZY8K3M4N5P6Q7R8S9T0V1W2",
  "attemptNumber": 1,
  "outputs": ["artifacts/frames/s1.png", "artifacts/frames/s2.png"],
  "durationMs": 4120
}
```

`fixtures/execution-event/invalid/leased-without-lease.json` — a lease that cannot be matched to its closing event:

```json
{
  "stageId": "illustrations",
  "attemptNumber": 1,
  "ttlMs": 300000,
  "expiresAt": "2026-09-16T12:05:00Z",
  "holder": "gateway/pid-4821"
}
```

`fixtures/execution-event/invalid/negative-attempt.json`:

```json
{
  "stageId": "illustrations",
  "leaseId": "lease_01HZY8K3M4N5P6Q7R8S9T0V1W2",
  "attemptNumber": 0
}
```

- [ ] **Step 3: Write the fixture checker**

Create `studio/contracts/scripts/check-execution-event-fixtures.mjs`, modelled exactly on the existing `check-gate-review-fixtures.mjs` in the same directory — same ajv setup, same ok/FAIL output, same non-zero exit on failure. Validate `valid/stage-leased.json` against `#/$defs/StageLeased` and `valid/stage-completed.json` against `#/$defs/StageCompleted`; assert `invalid/leased-without-lease.json` is rejected by `StageLeased` and `invalid/negative-attempt.json` by `StageStarted`.

- [ ] **Step 4: Run the checker**

Run: `cd studio/contracts && node scripts/check-execution-event-fixtures.mjs`
Expected: four `ok` lines and a success message.

- [ ] **Step 5: Wire it into `check:schemas` and regenerate bindings**

Append `&& node scripts/check-execution-event-fixtures.mjs` to `check:schemas` in `studio/contracts/package.json`.

Run: `npm run bindings:generate -w @studio/contracts && npm run bindings:check -w @studio/contracts`
Expected: creates `bindings/ts/execution-event.ts`; the check exits 0. `generate-ts-bindings.mjs` auto-discovers every schema, so skipping this fails CI.

- [ ] **Step 6: Run the contracts check and commit**

Run: `npm run check -w @studio/contracts`
Expected: PASS.

```bash
git add studio/contracts/schemas studio/contracts/fixtures/execution-event \
        studio/contracts/scripts/check-execution-event-fixtures.mjs \
        studio/contracts/bindings/ts/execution-event.ts studio/contracts/package.json
git commit -m "contracts: schema for the execution events state is replayed from

Every payload carries leaseId and attemptNumber. A stage attempted three
times produces three interleaved runs of events, and without both a
reader cannot tell which stage-failed closes which stage-started."
```

---

### Task 4: `deriveExecutionState` — replay

**Files:**
- Create: `studio/contracts/src/execution-state.mjs`
- Create: `studio/contracts/src/execution-state.d.mts`
- Create: `studio/contracts/test/execution-state.test.mjs`

**Interfaces:**
- Consumes: journal events shaped by Task 1 (`event.data`, `event.type`); payloads from Task 3.
- Produces: `deriveExecutionState(events, stageIds, now)` → `Map<string, StageInstance>` where `StageInstance` is `{ stageId, status, attempts, outputArtifacts, createdAt }` and `status` is `"pending" | "running" | "completed" | "failed"`. Task 5 adds lease liveness to the same module.

**Note on the signature:** it takes `stageIds: string[]`, not a `ResolvedPipeline`. `@studio/contracts` must not depend on `@studio/runtime` — the dependency runs the other way. The caller passes the declared stage ids.

- [ ] **Step 1: Write the failing tests**

Create `studio/contracts/test/execution-state.test.mjs`:

```js
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { deriveExecutionState } from "../src/execution-state.mjs";

const ref = { channel: "c", series: "s", episode: "e" };
let seq = 0;
/** A journal event in the shape buildJournalEvent produces. */
const evt = (type, data, actor = "runtime") => ({
  apiVersion: "studio.video/v1alpha1",
  kind: "JournalEvent",
  id: `evt_${String(seq++).padStart(26, "0")}`,
  episodeRef: ref,
  at: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
  actor,
  type,
  data,
});

const lease = (stageId, leaseId, attemptNumber, expiresAt = "2999-01-01T00:00:00Z") =>
  evt("stage-leased", { stageId, leaseId, attemptNumber, ttlMs: 300000, expiresAt, holder: "test/1" });

const NOW = new Date("2026-09-16T12:00:00Z");

describe("deriveExecutionState", () => {
  it("reports a declared stage the journal never mentions as pending", () => {
    const state = deriveExecutionState([], ["illustrations", "captions"], NOW);
    assert.equal(state.get("illustrations").status, "pending");
    assert.equal(state.get("captions").attempts.length, 0);
  });

  it("follows one attempt from lease to completion", () => {
    const events = [
      lease("illustrations", "L1", 1),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
      evt("stage-completed", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1,
        outputs: ["artifacts/frames/s1.png"] }),
    ];

    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");

    assert.equal(inst.status, "completed");
    assert.equal(inst.attempts.length, 1);
    assert.equal(inst.attempts[0].outcome, "success");
    assert.deepEqual(inst.outputArtifacts, ["artifacts/frames/s1.png"]);
  });

  it("leaves a stage running when its attempt was never closed", () => {
    // The crash case: the process died between starting and finishing.
    const events = [
      lease("illustrations", "L1", 1),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
    ];
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");
    assert.equal(inst.status, "running");
    assert.equal(inst.attempts[0].endedAt, undefined);
  });

  it("attributes interleaved attempts by leaseId, not by order", () => {
    const events = [
      lease("illustrations", "L1", 1),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
      evt("stage-failed", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1,
        error: "boom", retryable: true }),
      lease("illustrations", "L2", 2),
      evt("stage-started", { stageId: "illustrations", leaseId: "L2", attemptNumber: 2 }),
      evt("stage-completed", { stageId: "illustrations", leaseId: "L2", attemptNumber: 2,
        outputs: ["artifacts/frames/s1.png"] }),
    ];

    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");

    assert.equal(inst.attempts.length, 2);
    assert.equal(inst.attempts[0].outcome, "failure");
    assert.equal(inst.attempts[0].error, "boom");
    assert.equal(inst.attempts[1].outcome, "success");
    assert.equal(inst.status, "completed");
  });

  it("is deterministic — the same events replay to the same state", () => {
    const events = [
      lease("illustrations", "L1", 1),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
      evt("stage-failed", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1, error: "x" }),
    ];
    const a = deriveExecutionState(events, ["illustrations"], NOW);
    const b = deriveExecutionState(events, ["illustrations"], NOW);
    assert.deepEqual([...a.entries()], [...b.entries()]);
  });

  it("fails closed on an event for a stage the pipeline does not declare", () => {
    // The pipeline changed under a running episode. Guessing is how the old
    // code got into trouble.
    const events = [lease("ghost-stage", "L1", 1)];
    assert.throws(() => deriveExecutionState(events, ["illustrations"], NOW), /ghost-stage/);
  });

  it("fails closed when an event closes an attempt that was never opened", () => {
    const events = [
      evt("stage-completed", { stageId: "illustrations", leaseId: "L9", attemptNumber: 1, outputs: [] }),
    ];
    assert.throws(() => deriveExecutionState(events, ["illustrations"], NOW), /L9/);
  });

  it("fails closed on a transition the state machine forbids", () => {
    // completed is terminal; a second lease on a completed stage is not a retry
    // the machine allows from that state.
    const events = [
      lease("illustrations", "L1", 1),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
      evt("stage-completed", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1, outputs: ["a"] }),
      lease("illustrations", "L2", 2),
    ];
    assert.throws(() => deriveExecutionState(events, ["illustrations"], NOW), /completed/);
  });

  it("ignores journal events that are not execution events", () => {
    const events = [
      evt("approval-requested", { stageId: "illustrations", decision: "requested" }, "gateway"),
      evt("comment-added", { stageId: "illustrations", body: "looks good" }, "human"),
    ];
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");
    assert.equal(inst.status, "pending");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @studio/contracts`
Expected: FAIL — cannot resolve `../src/execution-state.mjs`.

- [ ] **Step 3: Write the implementation**

Create `studio/contracts/src/execution-state.mjs`:

```js
// ---------------------------------------------------------------------------
// Execution state, derived
// ---------------------------------------------------------------------------
// Which stages ran, how many times, and how each attempt ended — computed by
// replaying the journal, not read from a second copy that could disagree with
// it. The same principle deriveGateState works on: the answer is computed from
// the record at the moment of asking, so there is nowhere for a stale truth to
// live.
//
// StageInstance mirrors the shape studio/runtime/src/engine/types.ts defines,
// so the engine's own executor and the rerun planner can consume it. The types
// are duplicated rather than imported because the dependency runs the other
// way: runtime depends on contracts, never the reverse.
// ---------------------------------------------------------------------------

/** Journal event types this module interprets. Everything else is ignored. */
const EXECUTION_EVENTS = Object.freeze([
  "stage-leased", "stage-started", "stage-completed", "stage-failed", "attempt-recorded",
]);

/** Mirrors VALID_TRANSITIONS in studio/runtime/src/engine/types.ts. */
const VALID_TRANSITIONS = Object.freeze({
  pending: ["running"],
  running: ["completed", "failed"],
  completed: [],
  failed: ["pending"],
});

function transition(instance, to, because) {
  const from = instance.status;
  if (from === to) return;
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new Error(
      `Stage "${instance.stageId}" cannot go from ${from} to ${to} (${because}): ` +
      `the state machine does not allow it, and coercing it would invent history`,
    );
  }
  instance.status = to;
}

/**
 * Replay a journal into per-stage execution state.
 *
 * `stageIds` are the stages the resolved pipeline declares. `now` is the clock
 * — passed in rather than read, so a replay is reproducible.
 *
 * Fails closed rather than skipping: an event naming an undeclared stage, or
 * closing an attempt that was never opened, means the journal and the pipeline
 * disagree about reality, and guessing which is right is how file-existence
 * inference got into the codebase in the first place.
 */
export function deriveExecutionState(events, stageIds, now = new Date()) {
  const state = new Map();
  for (const stageId of stageIds) {
    state.set(stageId, {
      stageId,
      status: "pending",
      attempts: [],
      outputArtifacts: [],
      createdAt: null,
    });
  }

  for (const event of events) {
    if (!EXECUTION_EVENTS.includes(event.type)) continue;

    const data = event.data ?? {};
    const { stageId, leaseId } = data;
    const instance = state.get(stageId);
    if (!instance) {
      throw new Error(
        `Journal names stage "${stageId}", which this pipeline does not declare. ` +
        `The pipeline changed under a running episode.`,
      );
    }
    if (instance.createdAt === null) instance.createdAt = event.at;

    if (event.type === "stage-leased") {
      transition(instance, "pending", "a new lease");
      instance.attempts.push({
        number: data.attemptNumber,
        leaseId,
        startedAt: event.at,
        ttlMs: data.ttlMs,
        expiresAt: data.expiresAt,
        holder: data.holder,
      });
      continue;
    }

    const attempt = instance.attempts.find((a) => a.leaseId === leaseId);
    if (!attempt) {
      throw new Error(
        `Journal closes attempt "${leaseId}" on stage "${stageId}", which was never opened. ` +
        `A terminal event without its lease cannot be placed in the history.`,
      );
    }

    switch (event.type) {
      case "stage-started":
        transition(instance, "running", "the attempt started");
        break;
      case "stage-completed":
        transition(instance, "completed", "the attempt completed");
        attempt.endedAt = event.at;
        attempt.outcome = "success";
        instance.outputArtifacts = data.outputs ?? [];
        break;
      case "stage-failed":
        transition(instance, "failed", "the attempt failed");
        attempt.endedAt = event.at;
        attempt.outcome = "failure";
        attempt.error = data.error;
        attempt.retryable = data.retryable;
        break;
      case "attempt-recorded":
        attempt.endedAt = event.at;
        attempt.outcome = data.outcome;
        if (data.outputs) instance.outputArtifacts = data.outputs;
        break;
    }
  }

  return state;
}
```

Note the `stage-leased` handler calls `transition(instance, "pending", …)`. For a first attempt the stage is already `pending` and nothing happens; after a `failed` attempt, `failed → pending` is the retry the machine allows; after `completed` it throws, because `completed` is terminal. That is the forbidden-transition test.

- [ ] **Step 4: Write the type declarations**

Create `studio/contracts/src/execution-state.d.mts`:

```ts
import type { JournalEvent } from "./journal.d.mts";

export type StageStatus = "pending" | "running" | "completed" | "failed";

export interface StageAttempt {
  number: number;
  leaseId: string;
  startedAt: string;
  endedAt?: string;
  outcome?: "success" | "failure" | "timeout";
  error?: string;
  retryable?: boolean;
  ttlMs?: number;
  expiresAt?: string;
  holder?: string;
}

export interface StageInstance {
  stageId: string;
  status: StageStatus;
  attempts: StageAttempt[];
  outputArtifacts: string[];
  createdAt: string | null;
}

export declare function deriveExecutionState(
  events: JournalEvent[],
  stageIds: string[],
  now?: Date,
): Map<string, StageInstance>;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @studio/contracts`
Expected: PASS — all nine new tests.

- [ ] **Step 6: Commit**

```bash
git add studio/contracts/src/execution-state.mjs studio/contracts/src/execution-state.d.mts \
        studio/contracts/test/execution-state.test.mjs
git commit -m "contracts: derive execution state by replaying the journal

StageInstance lived in an in-memory Map that nothing wrote, while
rerun/recovery.ts and rerun/planner.ts both consumed that map as input —
reading state the project never produced.

Replay is deterministic because there is nowhere else for state to hide.
An event naming an undeclared stage, closing an unopened attempt, or
making a transition the machine forbids fails closed rather than being
skipped."
```

---

### Task 5: Lease liveness and expiry

**Files:**
- Modify: `studio/contracts/src/execution-state.mjs` (append)
- Modify: `studio/contracts/src/execution-state.d.mts` (append)
- Modify: `studio/contracts/test/execution-state.test.mjs` (append a describe)

**Interfaces:**
- Consumes: `deriveExecutionState` from Task 4.
- Produces: `leaseState(instance, now)` → `{ state: "none" | "live" | "expired"; holder?: string; expiresAt?: string }`, and `deriveExecutionState` marking a timed-out attempt.

- [ ] **Step 1: Write the failing tests**

Append to `studio/contracts/test/execution-state.test.mjs`, reusing the `evt` / `lease` / `NOW` helpers already at module scope:

```js
describe("lease liveness", () => {
  it("reports no lease for a stage that never took one", () => {
    const state = deriveExecutionState([], ["illustrations"], NOW);
    assert.equal(leaseState(state.get("illustrations"), NOW).state, "none");
  });

  it("reports a live lease while the attempt is open and unexpired", () => {
    const events = [
      lease("illustrations", "L1", 1, "2026-09-16T12:05:00Z"),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
    ];
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");

    const live = leaseState(inst, NOW);
    assert.equal(live.state, "live");
    assert.equal(live.holder, "test/1");
  });

  it("reports the lease expired once the clock passes its expiry", () => {
    const events = [
      lease("illustrations", "L1", 1, "2026-09-16T11:55:00Z"),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
    ];
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");
    assert.equal(leaseState(inst, NOW).state, "expired");
  });

  it("reports no live lease once the attempt closed, however recent", () => {
    const events = [
      lease("illustrations", "L1", 1, "2999-01-01T00:00:00Z"),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
      evt("stage-completed", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1, outputs: ["a"] }),
    ];
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");
    assert.equal(leaseState(inst, NOW).state, "none");
  });

  it("marks an expired open attempt as timed out and the stage as retryable", () => {
    // The crash case with an expired lease: the holder is gone and is not
    // coming back, so the attempt is a timeout and the stage may be retried.
    const events = [
      lease("illustrations", "L1", 1, "2026-09-16T11:55:00Z"),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
    ];
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");

    assert.equal(inst.attempts[0].outcome, "timeout");
    assert.equal(inst.status, "failed");
  });

  it("leaves an unexpired open attempt running, not timed out", () => {
    const events = [
      lease("illustrations", "L1", 1, "2999-01-01T00:00:00Z"),
      evt("stage-started", { stageId: "illustrations", leaseId: "L1", attemptNumber: 1 }),
    ];
    const inst = deriveExecutionState(events, ["illustrations"], NOW).get("illustrations");
    assert.equal(inst.attempts[0].outcome, undefined);
    assert.equal(inst.status, "running");
  });
});
```

Update the import at the top of the file to `import { deriveExecutionState, leaseState } from "../src/execution-state.mjs";`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @studio/contracts`
Expected: FAIL — `leaseState is not a function`, and the timeout test fails because nothing expires an attempt yet.

- [ ] **Step 3: Implement expiry inside the replay**

In `deriveExecutionState`, immediately before `return state;`, add:

```js
  // An open attempt whose lease has expired did not finish — its holder is gone
  // and is not coming back. Expiry is not a status of its own: the attempt is a
  // timeout, and the stage lands on `failed`, which is the state the machine
  // already allows a retry from.
  for (const instance of state.values()) {
    const open = instance.attempts.find((a) => a.outcome === undefined);
    if (!open || !open.expiresAt) continue;
    if (new Date(open.expiresAt).getTime() > now.getTime()) continue;
    open.outcome = "timeout";
    open.endedAt = open.expiresAt;
    if (instance.status === "running") transition(instance, "failed", "the lease expired");
  }
```

- [ ] **Step 4: Implement `leaseState`**

Append to `studio/contracts/src/execution-state.mjs`:

```js
/**
 * The lease on a stage, now.
 *
 * A lease is live when an attempt is open and its expiry has not passed. The
 * journal records that a lease was granted; it cannot arbitrate who won a race,
 * which is what the Lock port is for. This answers only "is someone holding
 * this, and until when".
 */
export function leaseState(instance, now = new Date()) {
  const open = instance.attempts.find((a) => a.outcome === undefined);
  if (!open || !open.expiresAt) {
    // An attempt timed out by the replay above is closed, not live — a stage
    // whose holder vanished must be retryable, not blocked forever.
    const expired = [...instance.attempts].reverse().find((a) => a.outcome === "timeout");
    if (expired) {
      return { state: "expired", holder: expired.holder, expiresAt: expired.expiresAt };
    }
    return { state: "none" };
  }
  return { state: "live", holder: open.holder, expiresAt: open.expiresAt };
}
```

- [ ] **Step 5: Append the type declarations**

```ts
export interface LeaseState {
  state: "none" | "live" | "expired";
  holder?: string;
  expiresAt?: string;
}

export declare function leaseState(instance: StageInstance, now?: Date): LeaseState;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w @studio/contracts`
Expected: PASS — all fifteen tests in the file.

- [ ] **Step 7: Commit**

```bash
git add studio/contracts/src/execution-state.mjs studio/contracts/src/execution-state.d.mts \
        studio/contracts/test/execution-state.test.mjs
git commit -m "contracts: expire leases during replay, and report who holds one

An open attempt past its expiry is a timeout, not a perpetual lock: the
holder is gone and the stage must be retryable. Expiry introduces no new
status — the attempt is a timeout and the stage lands on failed, which is
where the existing machine already allows a retry from."
```

---

### Task 6: A real filesystem `Lock`

**Files:**
- Create: `studio/runtime/src/ports/file-lock.ts`
- Modify: `studio/runtime/src/ports/index.ts` (export it)
- Create: `studio/runtime/test/unit/ports/file-lock.test.ts`

**Interfaces:**
- Consumes: the existing `Lock`, `Lease`, `LockError` types in `studio/runtime/src/ports/lock.ts`, and `Result`/`ok`/`err` from `studio/runtime/src/result.js`.
- Produces: `class FileLock implements Lock`, constructed as `new FileLock(rootDir, clock?)`.

**Why this task exists:** an append-only log can record that a lease was granted but cannot arbitrate a race — two processes would both append `stage-leased` and both believe they hold the stage. The gateway, CLI and agent genuinely run concurrently on one machine. `Lock` has existed as an interface since the runtime was written, with no implementation but a test fixture.

- [ ] **Step 1: Write the failing tests**

Create `studio/runtime/test/unit/ports/file-lock.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLock } from "../../../src/ports/file-lock.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function lockRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "file-lock-"));
  roots.push(root);
  return root;
}

describe("FileLock", () => {
  it("grants a lease on a free resource", async () => {
    const lock = new FileLock(await lockRoot());
    const got = await lock.acquire("stage:illustrations", 60_000);

    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.value.resource).toBe("stage:illustrations");
      expect(got.value.token).toMatch(/\S/);
      expect(got.value.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("refuses a resource someone else holds", async () => {
    const lock = new FileLock(await lockRoot());
    await lock.acquire("stage:illustrations", 60_000);

    const second = await lock.acquire("stage:illustrations", 60_000);

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("LEASE_CONFLICT");
  });

  it("lets exactly one of many concurrent acquirers win", async () => {
    // This is the whole point: the filesystem arbitrates, not the caller.
    const lock = new FileLock(await lockRoot());
    const results = await Promise.all(
      Array.from({ length: 12 }, () => lock.acquire("stage:illustrations", 60_000)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("reclaims a lease whose expiry has passed", async () => {
    const lock = new FileLock(await lockRoot());
    const first = await lock.acquire("stage:illustrations", 1);
    expect(first.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 20));

    const second = await lock.acquire("stage:illustrations", 60_000);
    expect(second.ok).toBe(true);
  });

  it("does not let a stale token release the current holder", async () => {
    const lock = new FileLock(await lockRoot());
    const first = await lock.acquire("stage:illustrations", 1);
    if (!first.ok) throw new Error("setup failed");
    await new Promise((r) => setTimeout(r, 20));
    const second = await lock.acquire("stage:illustrations", 60_000);
    if (!second.ok) throw new Error("setup failed");

    // The first holder wakes up late and tries to tidy up.
    await lock.release(first.value);

    // The second holder must still hold it.
    const third = await lock.acquire("stage:illustrations", 60_000);
    expect(third.ok).toBe(false);
  });

  it("releases idempotently", async () => {
    const lock = new FileLock(await lockRoot());
    const got = await lock.acquire("stage:illustrations", 60_000);
    if (!got.ok) throw new Error("setup failed");

    expect((await lock.release(got.value)).ok).toBe(true);
    expect((await lock.release(got.value)).ok).toBe(true);
    expect((await lock.acquire("stage:illustrations", 60_000)).ok).toBe(true);
  });

  it("renews only for the token that holds the lease", async () => {
    const lock = new FileLock(await lockRoot());
    const got = await lock.acquire("stage:illustrations", 60_000);
    if (!got.ok) throw new Error("setup failed");

    const renewed = await lock.renew(got.value, 120_000);
    expect(renewed.ok).toBe(true);
    if (renewed.ok) {
      expect(renewed.value.expiresAt.getTime()).toBeGreaterThan(got.value.expiresAt.getTime());
    }

    const impostor = { ...got.value, token: "not-the-token" };
    expect((await lock.renew(impostor, 120_000)).ok).toBe(false);
  });

  it("keeps separate resources independent", async () => {
    const lock = new FileLock(await lockRoot());
    expect((await lock.acquire("stage:illustrations", 60_000)).ok).toBe(true);
    expect((await lock.acquire("stage:captions", 60_000)).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @studio/runtime -- file-lock`
Expected: FAIL — cannot resolve `../../../src/ports/file-lock.js`.

- [ ] **Step 3: Write the implementation**

Create `studio/runtime/src/ports/file-lock.ts`:

```ts
// ---------------------------------------------------------------------------
// Filesystem lock
// ---------------------------------------------------------------------------
// The Lock port has existed since the runtime was written, with no
// implementation but a test fixture — so nothing in the project could actually
// arbitrate a race.
//
// An append-only journal can record that a lease was granted. It cannot decide
// who won: two processes would both append stage-leased and both believe they
// hold the stage. The gateway, the CLI and the agent genuinely run
// concurrently on one machine, so that race is real.
//
// `wx` is the arbitration. The filesystem decides, not the caller.
//
// Per-machine by construction. A distributed lock is a different problem and
// this must not pretend to solve it.
// ---------------------------------------------------------------------------

import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { ok, err, type Result } from "../result.js";
import type { Lock, Lease, LockError } from "./lock.js";

interface LockFile {
  token: string;
  expiresAt: string;
  resource: string;
}

export class FileLock implements Lock {
  constructor(
    private readonly rootDir: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** One file per resource. The name is derived, never the caller's string. */
  private fileFor(resource: string): string {
    const safe = Buffer.from(resource).toString("base64url");
    return path.join(this.rootDir, `${safe}.lock`);
  }

  private async read(file: string): Promise<LockFile | null> {
    try {
      return JSON.parse(await readFile(file, "utf-8")) as LockFile;
    } catch {
      return null;
    }
  }

  async acquire(resource: string, ttlMs: number): Promise<Result<Lease, LockError>> {
    const file = this.fileFor(resource);
    await mkdir(this.rootDir, { recursive: true });

    const lease: LockFile = {
      token: randomUUID(),
      expiresAt: new Date(this.now() + ttlMs).toISOString(),
      resource,
    };

    try {
      // `wx` fails if the file exists. This is the arbitration.
      await writeFile(file, JSON.stringify(lease), { flag: "wx" });
      return ok({ resource, token: lease.token, expiresAt: new Date(lease.expiresAt) });
    } catch {
      // Held — unless whoever held it is past their expiry.
      const held = await this.read(file);
      if (held && new Date(held.expiresAt).getTime() > this.now()) {
        return err({
          code: "LEASE_CONFLICT",
          message: `"${resource}" is held until ${held.expiresAt}`,
          resource,
        });
      }

      // Reclaim: remove the expired file and retry once. A loser of this race
      // finds the file present again and reports a conflict, which is correct —
      // someone did win it.
      try {
        await unlink(file);
      } catch { /* another reclaimer got there first */ }
      try {
        await writeFile(file, JSON.stringify(lease), { flag: "wx" });
        return ok({ resource, token: lease.token, expiresAt: new Date(lease.expiresAt) });
      } catch {
        return err({
          code: "LEASE_CONFLICT",
          message: `"${resource}" was taken while reclaiming an expired lease`,
          resource,
        });
      }
    }
  }

  async release(lease: Lease): Promise<Result<void, LockError>> {
    const file = this.fileFor(lease.resource);
    const held = await this.read(file);

    // Idempotent, and token-checked: a holder whose lease already expired must
    // not be able to release the lease that replaced it.
    if (!held || held.token !== lease.token) return ok(undefined);

    try {
      await unlink(file);
    } catch { /* already gone */ }
    return ok(undefined);
  }

  async renew(lease: Lease, ttlMs: number): Promise<Result<Lease, LockError>> {
    const file = this.fileFor(lease.resource);
    const held = await this.read(file);

    if (!held || held.token !== lease.token) {
      return err({
        code: "LEASE_LOST",
        message: `"${lease.resource}" is no longer held by this token`,
        resource: lease.resource,
      });
    }

    const renewed: LockFile = { ...held, expiresAt: new Date(this.now() + ttlMs).toISOString() };
    await writeFile(file, JSON.stringify(renewed));
    return ok({
      resource: lease.resource,
      token: renewed.token,
      expiresAt: new Date(renewed.expiresAt),
    });
  }
}
```

- [ ] **Step 4: Export it**

In `studio/runtime/src/ports/index.ts`, add:

```ts
export { FileLock } from "./file-lock.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @studio/runtime -- file-lock`
Expected: PASS — all eight tests.

- [ ] **Step 6: Run everything and typecheck**

Run:

```bash
npm test -w @studio/contracts && npm test -w @studio/runtime && npm test -w @studio/gateway
npx tsc --noEmit -p studio/runtime/tsconfig.json && npm run typecheck -w @studio/gateway
```

Expected: all pass, zero failures.

- [ ] **Step 7: Commit**

```bash
git add studio/runtime/src/ports/file-lock.ts studio/runtime/src/ports/index.ts \
        studio/runtime/test/unit/ports/file-lock.test.ts
git commit -m "runtime: a filesystem Lock, so leases can actually be arbitrated

The Lock port has existed since the runtime was written with no
implementation but a test fixture. A journal can record that a lease was
granted but cannot decide who won a race — two processes would both
append stage-leased and both believe they held the stage.

Writing the lockfile with the wx flag is the arbitration: the filesystem
decides, not the caller. Per-machine by construction."
```

---

## Self-Review

**Spec coverage:**

| spec section | task |
|---|---|
| 0. Prerequisite `avg-i1x` | 1 (writer + validation + strict read), 2 (call sites + redundant-write deletion) |
| 1. Execution event payloads | 3 |
| 1a. The `attempt-recorded` collision | 2 step 3 |
| 2. Replay `deriveExecutionState` | 4 |
| 2a. Fail-closed rules | 4 (three dedicated tests) |
| 2b. Vocabulary seam left to `avg-tt7` | 4 — `StageStatus` is the engine's four, not widened |
| 3. A real `Lock` | 6 |
| 4. Lease liveness and expiry | 5 |
| Testing section | 4, 5, 6 |

**Gap found and closed during review:** the spec's testing section asks for "restart recovery over a realistic journal with several stages and multiple attempts, including one crash". Task 4 covers the crash (`leaves a stage running when its attempt was never closed`) and interleaved attempts on a single stage, but no test replays several stages at once. Rather than add a ninth near-duplicate to Task 4, note it here for the executor: **if Task 4's reviewer finds multi-stage replay untested, that is a real gap, and the fix is one test building a journal across `illustrations` and `captions` and asserting both instances.**

**Deliberate deviation from the spec:** the spec describes validation "at append and at read". Task 1 implements structural validation at append (type, actor, episode ref, data shape) and strict-mode surfacing at read, but does NOT run ajv at runtime — `@studio/contracts` carries ajv as a devDependency only, and the gateway imports `journal.mjs` at runtime without it. Schema conformance is instead enforced by a contracts test that runs **real writer output** through ajv, which is precisely the check whose absence allowed `avg-i1x`. Promoting ajv to a runtime dependency of contracts would push it into the gateway's tree for every journal append; that trade was not worth it. If a reviewer disagrees, the change is one line in `package.json` plus an import.

**Type consistency:** `StageInstance` / `StageAttempt` field names in Task 4's `.d.mts` match the engine's `studio/runtime/src/engine/types.ts` (`number`, `leaseId`, `startedAt`, `endedAt`, `outcome`, `error`, `retryable`; `stageId`, `status`, `attempts`, `outputArtifacts`, `createdAt`) — deliberately, so the engine and the rerun planner can consume the result. Task 5's `leaseState` takes the `StageInstance` Task 4 produces. Task 6's `FileLock` implements the `Lock`/`Lease`/`LockError` already in `ports/lock.ts` and returns the existing `Result` type.

**One name the engine does not have:** Task 4's `StageAttempt` adds `ttlMs`, `expiresAt` and `holder`, which the engine's version lacks. That is additive and intentional — the engine never persisted a lease, so it never needed to describe one. Reconciling the two declarations belongs to `avg-tt7`, which is the first code to hold both.

## Risks

- **Task 2 is a wide, shallow change** across four packages. The grep in its step 1 is the definition of done; an unconverted call site fails at runtime, not at typecheck, because `data` is `Record<string, unknown>`.
- **Replay cost is unmeasured** and deliberately so — see the spec's Risks section. Do not add a checkpoint cache in this plan.
- **`FileLock`'s reclaim path has a deliberate small race**: two processes can both see an expired lockfile, both unlink, and one wins the retry. The loser reports `LEASE_CONFLICT`, which is correct — someone did win. Do not "fix" this with a lockfile-for-the-lockfile.
- **This plan ships no production caller** for `deriveExecutionState`, `leaseState` or `FileLock`. That is the point of slice A; the consumer is `avg-tt7`. A reviewer should not treat the absence as an oversight.
