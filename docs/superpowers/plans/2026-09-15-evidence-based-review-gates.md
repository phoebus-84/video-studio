# Evidence-Based Review Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the gateway executor inventing review results, and make every stage that claims completion prove it.

**Architecture:** Delete the two stage handlers that write literal findings. Add a gate-review record to `@studio/contracts` that binds a review to sha256 hashes of the artifacts reviewed, stored as journal events so it cannot be rewritten. Carry the `gates` the pipeline manifests already declare through the loader that currently discards them, and make the executor honour both of them — `autopilot` gating execution, `review` gating acceptance — validating declared outputs before reporting `completed`.

**Tech Stack:** TypeScript (gateway, runtime — vitest), JavaScript ESM `.mjs` + `.d.mts` (contracts — `node --test`), JSON Schema 2020-12 with ajv, bun workspaces.

**Spec:** `docs/superpowers/specs/2026-09-15-evidence-based-review-gates-design.md`

## Global Constraints

- **Issue:** `avg-qr4.1`. Branch `qr4.1-evidence-based-review-gates` already exists and holds the spec commit.
- **Contracts package uses `node --test`, not vitest.** Tests are `studio/contracts/test/*.test.mjs`, run with `npm test -w @studio/contracts`.
- **Gateway and runtime use vitest.** Run with `npm test -w @studio/gateway` / `-w @studio/runtime`.
- **Every `.mjs` in `studio/contracts/src/` has a companion `.d.mts`.** TypeScript consumers rely on it; the gateway is TypeScript and imports these modules directly.
- **New schema `$id` base is `https://video.studio/schemas/v1alpha1/`** — the base used by `journal-event.schema.json` and 7 others. (Five schemas use `https://schemas.studio.video/v1alpha1/` instead. That inconsistency predates this work; do not try to fix it here, and do not copy the minority form.)
- **`scripts/generate-ts-bindings.mjs` auto-discovers every `schemas/v1alpha1/*.schema.json`.** Adding a schema therefore changes generated bindings, and `npm run bindings:check` runs inside `npm run check`. Regenerate and commit the binding in the same task that adds the schema, or CI fails.
- **Gate-review records use the journal writer's actual field names** — `detail`, `episode`, `eventId` — not the names in `journal-event.schema.json`. The writer has never conformed to that schema; reconciling them is `avg-i1x` and is explicitly out of scope. Do not "fix" the field names while working here.
- **The gateway never writes `approval-granted`.** It may only ever emit `approval-requested`. Minting approvals is `avg-qr4.3`.
- **Commit after every task.** Do not squash tasks together.

---

## File Structure

| file | responsibility |
|---|---|
| `studio/contracts/schemas/v1alpha1/gate-review.schema.json` | **new** — the shape of a gate-review record |
| `studio/contracts/fixtures/gate-review/valid/*.json` | **new** — conforming examples |
| `studio/contracts/fixtures/gate-review/invalid/*.json` | **new** — examples that must be rejected |
| `studio/contracts/scripts/check-gate-review-fixtures.mjs` | **new** — validates those fixtures, wired into `check:schemas` |
| `studio/contracts/bindings/ts/gate-review.ts` | **new, generated** — do not hand-edit |
| `studio/contracts/src/gate-review.mjs` | **new** — `hashArtifacts`, `buildGateReview`, `deriveGateState` |
| `studio/contracts/src/gate-review.d.mts` | **new** — types for the above |
| `studio/contracts/test/gate-review.test.mjs` | **new** — tests for all three |
| `studio/runtime/src/pipeline/types.ts` | add `StageGates` to `StageDefinition` |
| `studio/runtime/src/pipeline/fs-loader.ts` | stop discarding `gates` in `toStageDef` |
| `studio/runtime/src/index.ts` | export `createDefaultLoader`, `FileSystemPipelineLoader`, `StageGates` |
| `studio/runtime/test/unit/pipeline/gates.test.ts` | **new** — gates survive load and inheritance |
| `studio/gateway/src/runtime/client.ts` | export the builtin-pipelines path resolver |
| `studio/gateway/src/runtime/executor.ts` | delete two handlers; gate enforcement; output validation; summary |
| `studio/gateway/test/fixtures/fabricated-safety-report.json` | **new** — the wolf report, quarantined |
| `studio/gateway/test/gate-enforcement.test.ts` | **new** — the acceptance criteria as tests |
| `studio/gateway/test/runtime-executor.test.ts` | extended |

---

### Task 1: Gate-review schema, fixtures, and bindings

**Files:**
- Create: `studio/contracts/schemas/v1alpha1/gate-review.schema.json`
- Create: `studio/contracts/fixtures/gate-review/valid/requested.json`
- Create: `studio/contracts/fixtures/gate-review/valid/approved.json`
- Create: `studio/contracts/fixtures/gate-review/invalid/approved-without-outputs.json`
- Create: `studio/contracts/fixtures/gate-review/invalid/bad-hash.json`
- Create: `studio/contracts/scripts/check-gate-review-fixtures.mjs`
- Modify: `studio/contracts/package.json` (the `check:schemas` script)
- Generated: `studio/contracts/bindings/ts/gate-review.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the schema `$id` `https://video.studio/schemas/v1alpha1/gate-review.schema.json` with `$defs` `ArtifactHash`, `GateCheck`, `GateReview`. Task 2 mirrors these names in `gate-review.d.mts`.

- [ ] **Step 1: Write the schema**

Create `studio/contracts/schemas/v1alpha1/gate-review.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://video.studio/schemas/v1alpha1/gate-review.schema.json",
  "title": "Gate review record",
  "description": "The payload carried in the `detail` of an approval-requested or approval-granted journal event. A review that cannot name the artifacts it examined, by hash, is not a review.",
  "$defs": {
    "ArtifactHash": {
      "type": "object",
      "additionalProperties": false,
      "required": ["path", "sha256"],
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "description": "Path relative to the episode directory. Never absolute: a record that names a reviewer's home directory cannot be checked anywhere else."
        },
        "sha256": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$",
          "description": "Lowercase hex sha256 of the file's bytes at the moment of review."
        }
      }
    },
    "GateCheck": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "name", "status"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "name": { "type": "string", "minLength": 1 },
        "status": { "enum": ["pass", "fail", "warn", "info"] },
        "expected": { "type": "string" },
        "actual": { "type": "string" },
        "evidence": {
          "type": "string",
          "description": "What was examined to reach this status — a path, a measurement, a tool invocation."
        }
      }
    },
    "GateReview": {
      "type": "object",
      "additionalProperties": false,
      "required": ["stageId", "decision", "actor", "at", "inputs", "outputs", "checks"],
      "properties": {
        "stageId": { "type": "string", "minLength": 1 },
        "decision": {
          "enum": ["requested", "approved"],
          "description": "There is deliberately no 'rejected'. JOURNAL_EVENTS has no approval-rejected type, and encoding a rejection inside an approval-granted event would contradict itself on disk. See avg-qr4.3."
        },
        "actor": { "enum": ["pi", "gateway", "runtime", "human", "system"] },
        "at": { "type": "string", "format": "date-time" },
        "inputs": { "type": "array", "items": { "$ref": "#/$defs/ArtifactHash" } },
        "outputs": { "type": "array", "items": { "$ref": "#/$defs/ArtifactHash" } },
        "checks": { "type": "array", "items": { "$ref": "#/$defs/GateCheck" } },
        "note": { "type": "string" }
      },
      "allOf": [
        {
          "if": { "properties": { "decision": { "const": "approved" } }, "required": ["decision"] },
          "then": {
            "properties": { "outputs": { "minItems": 1 } },
            "description": "An approval must name at least one artifact. Approving nothing is the bug this issue exists to remove."
          }
        }
      ]
    }
  }
}
```

- [ ] **Step 2: Write the fixtures**

`fixtures/gate-review/valid/requested.json`:

```json
{
  "stageId": "safety-review",
  "decision": "requested",
  "actor": "gateway",
  "at": "2026-09-15T11:30:00Z",
  "inputs": [
    { "path": "artifacts/script.md", "sha256": "3b1f2c9d4e5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e" }
  ],
  "outputs": [],
  "checks": [],
  "note": "safety-review declares autopilot: false; a human must run this stage."
}
```

`fixtures/gate-review/valid/approved.json`:

```json
{
  "stageId": "qa",
  "decision": "approved",
  "actor": "human",
  "at": "2026-09-15T12:00:00Z",
  "inputs": [
    { "path": "output/final.mp4", "sha256": "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90" }
  ],
  "outputs": [
    { "path": "artifacts/qa-report.json", "sha256": "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0" }
  ],
  "checks": [
    {
      "id": "duration",
      "name": "Render duration",
      "status": "pass",
      "expected": "30-480s",
      "actual": "89.833s",
      "evidence": "ffprobe -show_entries format=duration output/final.mp4"
    }
  ]
}
```

`fixtures/gate-review/invalid/approved-without-outputs.json` — an approval that names nothing:

```json
{
  "stageId": "qa",
  "decision": "approved",
  "actor": "human",
  "at": "2026-09-15T12:00:00Z",
  "inputs": [],
  "outputs": [],
  "checks": []
}
```

`fixtures/gate-review/invalid/bad-hash.json` — a truncated digest:

```json
{
  "stageId": "qa",
  "decision": "requested",
  "actor": "gateway",
  "at": "2026-09-15T12:00:00Z",
  "inputs": [{ "path": "output/final.mp4", "sha256": "abc123" }],
  "outputs": [],
  "checks": []
}
```

- [ ] **Step 3: Write the fixture checker**

Create `studio/contracts/scripts/check-gate-review-fixtures.mjs`, following `check-event-fixtures.mjs` exactly:

```js
#!/usr/bin/env node

/**
 * Validate gate-review fixtures.
 * Usage: node scripts/check-gate-review-fixtures.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const schema = JSON.parse(
  readFileSync(resolve(root, "schemas/v1alpha1/gate-review.schema.json"), "utf-8")
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(schema);
const validate = ajv.getSchema(`${schema.$id}#/$defs/GateReview`);
if (!validate) throw new Error("GateReview schema definition was not registered");

let failures = 0;

for (const fixturePath of [
  "fixtures/gate-review/valid/requested.json",
  "fixtures/gate-review/valid/approved.json",
]) {
  const fixture = JSON.parse(readFileSync(resolve(root, fixturePath), "utf-8"));
  if (!validate(fixture)) {
    failures++;
    console.error(`FAIL ${fixturePath} should be valid:`);
    for (const err of validate.errors ?? []) {
      console.error(`  ${err.instancePath || "/"} ${err.message}`);
    }
  } else {
    console.log(`ok   ${fixturePath}`);
  }
}

for (const fixturePath of [
  "fixtures/gate-review/invalid/approved-without-outputs.json",
  "fixtures/gate-review/invalid/bad-hash.json",
]) {
  const fixture = JSON.parse(readFileSync(resolve(root, fixturePath), "utf-8"));
  if (validate(fixture)) {
    failures++;
    console.error(`FAIL ${fixturePath} should have been rejected`);
  } else {
    console.log(`ok   ${fixturePath} rejected`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} gate-review fixture check(s) failed`);
  process.exit(1);
}
console.log("\nAll gate-review fixtures check out");
```

- [ ] **Step 4: Run the checker to verify it passes**

Run: `cd studio/contracts && node scripts/check-gate-review-fixtures.mjs`
Expected: four `ok` lines, then "All gate-review fixtures check out".

If `approved-without-outputs.json` is reported valid, the `allOf`/`if`/`then` block in the schema is wrong — ajv in `strict: true` mode silently ignores an `if` without a sibling `then`. Check the nesting before moving on.

- [ ] **Step 5: Wire the checker into `check:schemas`**

In `studio/contracts/package.json`, append to the end of the existing `check:schemas` chain:

```
&& node scripts/check-gate-review-fixtures.mjs
```

- [ ] **Step 6: Regenerate the TypeScript bindings**

Run: `cd studio/contracts && npm run bindings:generate`
Expected: creates `bindings/ts/gate-review.ts`. It is generated output — never hand-edit it.

Then run: `npm run bindings:check`
Expected: exits 0, reporting no drift.

- [ ] **Step 7: Run the whole contracts check**

Run: `npm run check -w @studio/contracts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add studio/contracts/schemas studio/contracts/fixtures/gate-review \
        studio/contracts/scripts/check-gate-review-fixtures.mjs \
        studio/contracts/bindings/ts/gate-review.ts studio/contracts/package.json
git commit -m "contracts: add the gate-review record schema

A review that cannot name the artifacts it examined, by hash, is not a
review. An approval must name at least one output: approving nothing is
the bug avg-qr4.1 exists to remove."
```

---

### Task 2: `hashArtifacts` and `buildGateReview`

**Files:**
- Create: `studio/contracts/src/gate-review.mjs`
- Create: `studio/contracts/src/gate-review.d.mts`
- Create: `studio/contracts/test/gate-review.test.mjs`

**Interfaces:**
- Consumes: `JOURNAL_ACTORS` from `../src/journal.mjs`.
- Produces:
  - `hashArtifacts(episodeDir: string, relativePaths: string[]): Promise<ArtifactHash[]>` — throws on a missing or empty file.
  - `buildGateReview(input): GateReview` — throws on invalid input.
  - `GATE_DECISIONS: readonly ["requested", "approved"]`.
  - Task 3 adds `deriveGateState` to the same module; Task 6 imports all of it from the gateway as `@studio/contracts/src/gate-review.mjs`.

- [ ] **Step 1: Write the failing tests**

Create `studio/contracts/test/gate-review.test.mjs`:

```js
import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { hashArtifacts, buildGateReview, GATE_DECISIONS } from "../src/gate-review.mjs";

/**
 * The gateway executor used to write a safety report about a wolf for every
 * episode, having opened none of them. These records exist so that a review
 * has to name what it looked at.
 */
describe("gate review records", () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "gate-review-"));
    await mkdir(path.join(dir, "artifacts"), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("hashArtifacts", () => {
    it("hashes a file's bytes and names it relatively", async () => {
      await writeFile(path.join(dir, "artifacts", "qa-report.json"), "{}");
      const expected = createHash("sha256").update("{}").digest("hex");

      const hashes = await hashArtifacts(dir, ["artifacts/qa-report.json"]);

      assert.equal(hashes.length, 1);
      assert.equal(hashes[0].path, "artifacts/qa-report.json");
      assert.equal(hashes[0].sha256, expected);
    });

    it("refuses to hash a file that is not there", async () => {
      await assert.rejects(
        () => hashArtifacts(dir, ["artifacts/never-written.json"]),
        /never-written\.json/,
      );
    });

    it("refuses to hash an empty file", async () => {
      await writeFile(path.join(dir, "artifacts", "empty.json"), "");
      await assert.rejects(
        () => hashArtifacts(dir, ["artifacts/empty.json"]),
        /empty/,
      );
    });
  });

  describe("buildGateReview", () => {
    const hash = "a".repeat(64);

    it("shapes a request", () => {
      const review = buildGateReview({
        stageId: "safety-review",
        decision: "requested",
        actor: "gateway",
        inputs: [{ path: "artifacts/script.md", sha256: hash }],
      });

      assert.equal(review.stageId, "safety-review");
      assert.equal(review.decision, "requested");
      assert.equal(review.actor, "gateway");
      assert.deepEqual(review.outputs, []);
      assert.deepEqual(review.checks, []);
      assert.match(review.at, /^\d{4}-\d{2}-\d{2}T/);
    });

    it("rejects a decision it does not define", () => {
      assert.throws(
        () => buildGateReview({ stageId: "qa", decision: "rejected", actor: "human" }),
        /decision/,
      );
      assert.deepEqual([...GATE_DECISIONS], ["requested", "approved"]);
    });

    it("rejects an actor the journal does not know", () => {
      assert.throws(
        () => buildGateReview({ stageId: "qa", decision: "requested", actor: "robot" }),
        /actor/,
      );
    });

    it("refuses an approval that names no artifact", () => {
      assert.throws(
        () => buildGateReview({ stageId: "qa", decision: "approved", actor: "human", outputs: [] }),
        /at least one/,
      );
    });

    it("requires a stage", () => {
      assert.throws(
        () => buildGateReview({ decision: "requested", actor: "gateway" }),
        /stage/,
      );
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @studio/contracts`
Expected: FAIL — cannot resolve `../src/gate-review.mjs`.

- [ ] **Step 3: Write the implementation**

Create `studio/contracts/src/gate-review.mjs`:

```js
// ---------------------------------------------------------------------------
// Gate review records
// ---------------------------------------------------------------------------
// A review gate is satisfied by evidence or it is not satisfied. The gateway
// executor used to write a safety report describing a wolf eating characters —
// the same text for every episode, having opened none of them — and the
// dispatcher called that stage completed.
//
// A record here names the artifacts it examined by sha256. That is what makes
// it checkable later: `deriveGateState` re-reads those files and compares, so a
// review that has been outrun by a re-render stops counting as a review.
//
// These records ride in the `detail` of approval-requested and approval-granted
// journal events. They use the field names journal.mjs actually writes, not the
// ones journal-event.schema.json describes; the two have never agreed, and
// reconciling them is avg-i1x.
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { JOURNAL_ACTORS } from "./journal.mjs";

/**
 * Decisions a record may carry.
 *
 * There is no "rejected". JOURNAL_EVENTS has no approval-rejected type, and an
 * approval-granted event carrying a rejection would contradict itself on disk.
 * Adding the event type belongs with the approval flow (avg-qr4.3); until then
 * a stage that is not approved stays requested, which already fails closed.
 */
export const GATE_DECISIONS = Object.freeze(["requested", "approved"]);

/**
 * Hash each path, relative to the episode directory.
 *
 * Throws rather than substituting a placeholder for a missing or empty file. A
 * record that hashes an absent file is the same lie in a new format, and the
 * whole point of the record is that it can be checked.
 */
export async function hashArtifacts(episodeDir, relativePaths) {
  const hashes = [];
  for (const relative of relativePaths) {
    if (path.isAbsolute(relative)) {
      throw new Error(
        `Cannot hash "${relative}": a record must name artifacts relative to the episode, ` +
        `or it can only be checked on the machine that wrote it`,
      );
    }
    let bytes;
    try {
      bytes = await readFile(path.join(episodeDir, relative));
    } catch {
      throw new Error(`Cannot hash "${relative}": no such file under ${episodeDir}`);
    }
    if (bytes.length === 0) {
      throw new Error(`Cannot hash "${relative}": the file is empty`);
    }
    hashes.push({ path: relative, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return hashes;
}

/**
 * Shape a record, without writing it.
 *
 * Separated from the append the same way buildJournalEvent is, so the shape is
 * testable without a filesystem.
 */
export function buildGateReview({
  stageId,
  decision,
  actor,
  inputs = [],
  outputs = [],
  checks = [],
  note,
  at,
}) {
  if (!stageId) {
    throw new Error("A gate review must name its stage");
  }
  if (!GATE_DECISIONS.includes(decision)) {
    throw new Error(
      `Unknown gate review decision: ${decision} (expected ${GATE_DECISIONS.join(" or ")})`,
    );
  }
  if (!JOURNAL_ACTORS.includes(actor)) {
    throw new Error(`Unknown gate review actor: ${actor}`);
  }
  if (decision === "approved" && outputs.length === 0) {
    throw new Error(
      `Stage "${stageId}" cannot be approved without naming at least one output: ` +
      `an approval of nothing cannot be invalidated by anything`,
    );
  }

  const review = {
    stageId,
    decision,
    actor,
    at: at ?? new Date().toISOString(),
    inputs,
    outputs,
    checks,
  };
  if (note !== undefined) review.note = note;
  return review;
}
```

Create `studio/contracts/src/gate-review.d.mts`:

```ts
// Type declarations for gate review records.
// Kept alongside gate-review.mjs so TypeScript consumers get the same contract
// the gateway relies on at runtime.

import type { JournalActor } from "./journal.d.mts";

export type GateDecision = "requested" | "approved";

export interface ArtifactHash {
  /** Path relative to the episode directory. */
  path: string;
  /** Lowercase hex sha256 of the file's bytes at the moment of review. */
  sha256: string;
}

export interface GateCheck {
  id: string;
  name: string;
  status: "pass" | "fail" | "warn" | "info";
  expected?: string;
  actual?: string;
  /** What was examined to reach this status. */
  evidence?: string;
}

export interface GateReview {
  stageId: string;
  decision: GateDecision;
  actor: JournalActor;
  at: string;
  inputs: ArtifactHash[];
  outputs: ArtifactHash[];
  checks: GateCheck[];
  note?: string;
}

export interface BuildGateReviewInput {
  stageId: string;
  decision: GateDecision;
  actor: JournalActor;
  inputs?: ArtifactHash[];
  outputs?: ArtifactHash[];
  checks?: GateCheck[];
  note?: string;
  at?: string;
}

export declare const GATE_DECISIONS: readonly ["requested", "approved"];

export declare function hashArtifacts(
  episodeDir: string,
  relativePaths: string[],
): Promise<ArtifactHash[]>;

export declare function buildGateReview(input: BuildGateReviewInput): GateReview;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @studio/contracts`
Expected: PASS, all eight new tests green.

- [ ] **Step 5: Commit**

```bash
git add studio/contracts/src/gate-review.mjs studio/contracts/src/gate-review.d.mts \
        studio/contracts/test/gate-review.test.mjs
git commit -m "contracts: hash artifacts and shape gate review records

hashArtifacts throws on a missing or empty file rather than hashing a
placeholder, and an approval must name an output — an approval of nothing
cannot be invalidated by anything."
```

---

### Task 3: `deriveGateState` — invalidation by re-hashing

**Files:**
- Modify: `studio/contracts/src/gate-review.mjs` (append)
- Modify: `studio/contracts/src/gate-review.d.mts` (append)
- Modify: `studio/contracts/test/gate-review.test.mjs` (append a `describe`)

**Interfaces:**
- Consumes: `hashArtifacts` from Task 2; `parseJournal`, `JOURNAL_RELATIVE_PATH` from `./journal.mjs`.
- Produces: `deriveGateState(events: JournalEvent[], stageId: string, episodeDir: string): Promise<GateState>` where `GateState` is `{ state: "none" | "requested" | "approved" | "invalidated"; reason?: string; at?: string; actor?: JournalActor }`. Task 6 does not call this, but the browser and `avg-qr4.3` will; it is the read side of the record.

- [ ] **Step 1: Write the failing tests**

Append to `studio/contracts/test/gate-review.test.mjs`, inside the outer `describe`:

```js
  describe("deriveGateState", () => {
    const evt = (type, detail, actor = "human") => ({
      eventId: `evt-${Math.random()}`,
      type,
      actor,
      at: new Date().toISOString(),
      episode: { channel: "c", series: "s", episode: "e" },
      stageId: detail.stageId,
      detail,
    });

    it("reports none when no one has asked for a review", async () => {
      const state = await deriveGateState([], "qa", dir);
      assert.equal(state.state, "none");
    });

    it("reports requested when a review was asked for but not granted", async () => {
      const events = [evt("approval-requested", { stageId: "qa", inputs: [], outputs: [] }, "gateway")];
      const state = await deriveGateState(events, "qa", dir);
      assert.equal(state.state, "requested");
    });

    it("reports approved while the reviewed bytes are unchanged", async () => {
      const file = path.join(dir, "artifacts", "qa-report.json");
      await writeFile(file, '{"verdict":"pass"}');
      const outputs = await hashArtifacts(dir, ["artifacts/qa-report.json"]);
      const events = [evt("approval-granted", { stageId: "qa", inputs: [], outputs })];

      const state = await deriveGateState(events, "qa", dir);

      assert.equal(state.state, "approved");
      assert.equal(state.actor, "human");
    });

    it("invalidates the review when a reviewed artifact changes", async () => {
      const file = path.join(dir, "artifacts", "qa-report.json");
      await writeFile(file, '{"verdict":"pass"}');
      const outputs = await hashArtifacts(dir, ["artifacts/qa-report.json"]);
      const events = [evt("approval-granted", { stageId: "qa", inputs: [], outputs })];

      // The render was redone after approval; the report is no longer the one
      // that was reviewed.
      await writeFile(file, '{"verdict":"fail"}');

      const state = await deriveGateState(events, "qa", dir);

      assert.equal(state.state, "invalidated");
      assert.match(state.reason, /changed/);
    });

    it("invalidates the review when a reviewed artifact is gone", async () => {
      const file = path.join(dir, "artifacts", "qa-report.json");
      await writeFile(file, '{"verdict":"pass"}');
      const outputs = await hashArtifacts(dir, ["artifacts/qa-report.json"]);
      const events = [evt("approval-granted", { stageId: "qa", inputs: [], outputs })];

      await rm(file);

      const state = await deriveGateState(events, "qa", dir);
      assert.equal(state.state, "invalidated");
    });

    it("reads the latest decision, not the first", async () => {
      const file = path.join(dir, "artifacts", "qa-report.json");
      await writeFile(file, '{"verdict":"pass"}');
      const outputs = await hashArtifacts(dir, ["artifacts/qa-report.json"]);
      const events = [
        evt("approval-requested", { stageId: "qa", inputs: [], outputs: [] }, "gateway"),
        evt("approval-granted", { stageId: "qa", inputs: [], outputs }),
      ];

      const state = await deriveGateState(events, "qa", dir);
      assert.equal(state.state, "approved");
    });

    it("ignores another stage's approval", async () => {
      const file = path.join(dir, "artifacts", "qa-report.json");
      await writeFile(file, '{"verdict":"pass"}');
      const outputs = await hashArtifacts(dir, ["artifacts/qa-report.json"]);
      const events = [evt("approval-granted", { stageId: "illustrations", inputs: [], outputs })];

      const state = await deriveGateState(events, "qa", dir);
      assert.equal(state.state, "none");
    });

    it("invalidates an approval that names nothing", async () => {
      // Belt and braces: buildGateReview refuses to make one, but a record
      // written by something else must not be trusted either.
      const events = [evt("approval-granted", { stageId: "qa", inputs: [], outputs: [] })];
      const state = await deriveGateState(events, "qa", dir);
      assert.equal(state.state, "invalidated");
    });
  });
```

Update the import at the top of the file to include `deriveGateState`:

```js
import { hashArtifacts, buildGateReview, deriveGateState, GATE_DECISIONS } from "../src/gate-review.mjs";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @studio/contracts`
Expected: FAIL — `deriveGateState is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `studio/contracts/src/gate-review.mjs`:

```js
/**
 * The current review state of a stage.
 *
 * Invalidation is a fresh read, not a subscription: the recorded hashes are
 * compared against the bytes on disk at the moment of asking. There is no
 * watcher, no cache and no bookkeeping to fall out of date, so a review that
 * was outrun by a re-render, copied from another episode, or simply forged
 * cannot survive being checked.
 *
 * `events` is the parsed journal — see parseJournal in ./journal.mjs.
 */
export async function deriveGateState(events, stageId, episodeDir) {
  const mine = events.filter(
    (event) => (event.detail?.stageId ?? event.stageId) === stageId,
  );

  const latest = [...mine]
    .reverse()
    .find((event) => event.type === "approval-granted" || event.type === "approval-requested");

  if (!latest) return { state: "none" };

  if (latest.type === "approval-requested") {
    return { state: "requested", at: latest.at, actor: latest.actor };
  }

  const recorded = [...(latest.detail?.inputs ?? []), ...(latest.detail?.outputs ?? [])];
  if (recorded.length === 0) {
    return {
      state: "invalidated",
      reason: "the approval named no artifacts, so there is nothing it could have reviewed",
    };
  }

  for (const { path: relative, sha256 } of recorded) {
    let current;
    try {
      [current] = await hashArtifacts(episodeDir, [relative]);
    } catch (err) {
      return { state: "invalidated", reason: err.message };
    }
    if (current.sha256 !== sha256) {
      return {
        state: "invalidated",
        reason: `"${relative}" changed since it was approved`,
      };
    }
  }

  return { state: "approved", at: latest.at, actor: latest.actor };
}
```

Append to `studio/contracts/src/gate-review.d.mts`:

```ts
export type GateStateName = "none" | "requested" | "approved" | "invalidated";

export interface GateState {
  state: GateStateName;
  /** Why a review is invalid, when it is. */
  reason?: string;
  at?: string;
  actor?: JournalActor;
}

export declare function deriveGateState(
  events: unknown[],
  stageId: string,
  episodeDir: string,
): Promise<GateState>;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @studio/contracts`
Expected: PASS — all sixteen tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add studio/contracts/src/gate-review.mjs studio/contracts/src/gate-review.d.mts \
        studio/contracts/test/gate-review.test.mjs
git commit -m "contracts: derive gate state by re-hashing what was reviewed

Changing a reviewed artifact invalidates its review, without a watcher or
a cache: the comparison is a fresh read at the moment of asking."
```

---

### Task 4: Carry `gates` through the pipeline loader

**Files:**
- Modify: `studio/runtime/src/pipeline/types.ts` (add `StageGates`, extend `StageDefinition`)
- Modify: `studio/runtime/src/pipeline/fs-loader.ts:83-93` (`toStageDef`)
- Modify: `studio/runtime/src/pipeline/index.ts` (export the type)
- Modify: `studio/runtime/src/index.ts` (export `createDefaultLoader`, `FileSystemPipelineLoader`, `StageGates`)
- Create: `studio/runtime/test/unit/pipeline/gates.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `StageGates { autopilot: boolean; review: string; retryOnFailure: number }` on `StageDefinition.gates`.
  - `createDefaultLoader` and `FileSystemPipelineLoader` importable from `@studio/runtime` (they are currently only reachable from the internal `./pipeline/index.js`).

**Why this task exists:** `toStageDef` declares `gates` in its YAML interface and then never copies it into `StageDefinition`. The manifests have always declared these gates; the loader has always thrown them away. Nothing downstream can honour a gate it cannot see.

- [ ] **Step 1: Write the failing test**

Create `studio/runtime/test/unit/pipeline/gates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FileSystemPipelineLoader } from "../../../src/pipeline/fs-loader.js";
import { resolvePipeline } from "../../../src/pipeline/resolver.js";

// The repo idiom: studio/runtime declares node >=20.0.0, and import.meta.dirname
// needs 20.11.
const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINES = resolve(__dirname, "../../../../pipelines/pipelines");

function loader() {
  return new FileSystemPipelineLoader([PIPELINES]);
}

describe("stage gates survive loading", () => {
  it("keeps the gates a stage declares", async () => {
    const def = await loader().load("fairy-tale-adaptation");
    const safety = def!.stages.find((s) => s.id === "safety-review");

    // safety-review declares autopilot: false, review: human. The executor ran
    // it in autopilot anyway and wrote a report about a wolf.
    expect(safety!.gates).toEqual({ autopilot: false, review: "human", retryOnFailure: 1 });
  });

  it("defaults to ungated when a stage declares no gates", async () => {
    // Absence of a gate is not a gate. A stage whose author asked for nothing
    // keeps today's behaviour; the fail-closed property comes from honouring
    // declared gates and validating outputs, not from gating by omission.
    const def = await loader().load("narrated-illustrated-video");
    const stage = def!.stages.find((s) => s.id === "brief");

    expect(stage!.gates.autopilot).toBe(true);
    expect(stage!.gates.review).toBe("none");
  });

  it("carries gates through pipeline inheritance", async () => {
    const resolved = await resolvePipeline(loader(), "fairy-tale-adaptation");

    // illustrations comes from the base pipeline, safety-review from the child.
    const illustrations = resolved.stages.find((s) => s.definition.id === "illustrations");
    const safety = resolved.stages.find((s) => s.definition.id === "safety-review");

    expect(illustrations!.definition.gates.review).toBe("human");
    expect(safety!.definition.gates.autopilot).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @studio/runtime -- gates`
Expected: FAIL — `gates` is undefined on `StageDefinition`.

- [ ] **Step 3: Add the type**

In `studio/runtime/src/pipeline/types.ts`, add above `StageDefinition`:

```ts
/**
 * What a stage's manifest asks for before the stage runs, and before its
 * output counts.
 *
 * These are two different gates and collapsing them loses information:
 * `autopilot` gates execution (may this run unattended?), `review` gates
 * acceptance (whose sign-off does the result need?). A stage can legitimately
 * run in autopilot and still not be finished.
 */
export interface StageGates {
  /** May this stage run unattended? */
  autopilot: boolean;
  /** Who must accept the output: "none" or "human". */
  review: string;
  /** How many times to retry on failure. */
  retryOnFailure: number;
}
```

Add to `StageDefinition`, after `consumes`:

```ts
  /** Gates declared by the manifest. Absent gates mean ungated, not blocked. */
  gates: StageGates;
```

- [ ] **Step 4: Stop discarding gates in the loader**

In `studio/runtime/src/pipeline/fs-loader.ts`, replace the body of `toStageDef` (lines 83-93) with:

```ts
function toStageDef(yaml: YamlStage, pipelineCaps: YamlPipeline["pipeline"]["capabilities"]): StageDefinition {
  return {
    id: yaml.id,
    name: yaml.name,
    type: (yaml.type === "editorial" || yaml.type === "capability") ? yaml.type as "editorial" | "capability" : "editorial",
    capabilities: toCapabilityRequest(yaml.capability, pipelineCaps),
    dependsOn: yaml.depends_on ?? [],
    produces: toArtifactRefs(yaml.outputs),
    consumes: toArtifactRefs(yaml.inputs),
    // Parsed since the loader was written, and dropped here until avg-qr4.1:
    // the manifests declared gates that nothing could read.
    gates: {
      autopilot: yaml.gates?.autopilot ?? true,
      review: yaml.gates?.review ?? "none",
      retryOnFailure: yaml.gates?.retry_on_failure ?? 0,
    },
  };
}
```

Add `StageGates` to the `StageDefinition` import at the top of the file if the import is explicit.

- [ ] **Step 5: Export the type and the loader**

In `studio/runtime/src/pipeline/index.ts`, add `StageGates` to the `export type { ... } from "./types.js"` block.

In `studio/runtime/src/index.ts`, add `StageGates` to the `export type { ... } from "./pipeline/index.js"` block (around line 132), and add the loader to the value export block (around line 121):

```ts
  FileSystemPipelineLoader,
  createDefaultLoader,
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w @studio/runtime -- gates`
Expected: PASS.

Then the full runtime suite, because `StageDefinition` gained a required field and fixtures may construct it:

Run: `npm test -w @studio/runtime && npm run typecheck -w @studio/runtime`
Expected: PASS. If `studio/runtime/test/fixtures/index.ts` or `test/unit/pipeline/snapshot.test.ts` fail to typecheck, add `gates: { autopilot: true, review: "none", retryOnFailure: 0 }` to the stage literals they build — do not make the field optional to dodge the error, because an optional gate is a gate that can be forgotten.

- [ ] **Step 7: Build the runtime so the gateway can import it**

Run: `npm run build -w @studio/runtime`
Expected: PASS. `@studio/runtime` resolves through `dist/`, so Task 6's gateway tests will not see these exports until this succeeds.

- [ ] **Step 8: Commit**

```bash
git add studio/runtime/src/pipeline/types.ts studio/runtime/src/pipeline/fs-loader.ts \
        studio/runtime/src/pipeline/index.ts studio/runtime/src/index.ts \
        studio/runtime/test/unit/pipeline/gates.test.ts
git commit -m "runtime: carry stage gates through the loader

toStageDef has always parsed gates and then dropped them, so the gates the
manifests declare could not be honoured by anything downstream. autopilot
gates execution; review gates acceptance."
```

---

### Task 5: Delete the fabricating handlers

**Files:**
- Modify: `studio/gateway/src/runtime/executor.ts` (delete lines 46-66 and 187-205, and two `HANDLERS` entries)
- Create: `studio/gateway/test/fixtures/fabricated-safety-report.json`
- Modify: `studio/gateway/test/runtime-executor.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a `HANDLERS` registry with four entries — `illustrations`, `captions`, `timing`, `qa`. Task 6 adds gate enforcement around it.

- [ ] **Step 1: Quarantine the fabricated report as a fixture**

Create `studio/gateway/test/fixtures/fabricated-safety-report.json` — the exact literal the executor used to write, kept only so tests can assert it never reaches a production artifact again:

```json
{
  "stage": "safety-review",
  "targetAudience": "children 4-8",
  "findings": [
    { "category": "violence", "severity": "low", "detail": "Wolf eating characters is implicit/off-screen" },
    { "category": "scariness", "severity": "moderate", "detail": "Wolf scenes may be intense for very young children" },
    { "category": "language", "severity": "none", "detail": "No inappropriate language" },
    { "category": "themes", "severity": "none", "detail": "Positive themes: bravery, helping others, stranger danger awareness" }
  ],
  "recommendation": "appropriate",
  "parentalGuidance": "May be scary for children under 4. Parental co-viewing recommended."
}
```

- [ ] **Step 2: Write the failing tests**

Append to `studio/gateway/test/runtime-executor.test.ts` (keep the existing test and its imports):

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HANDLERS } from "../src/runtime/executor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("fabricated reviews", () => {
  // handleSafetyReview wrote findings about a wolf eating characters, and
  // handleContinuityCheck wrote "scenes: 8" with four passing checks. Neither
  // opened a single file belonging to the episode it reported on, so every
  // episode got the same text.
  it("registers no handler that invents a review", () => {
    expect(Object.keys(HANDLERS).sort()).toEqual(["captions", "illustrations", "qa", "timing"]);
    expect(HANDLERS["safety-review"]).toBeUndefined();
    expect(HANDLERS["continuity-check"]).toBeUndefined();
  });

  it("keeps the fabricated report in fixtures only", () => {
    const fixture = readFileSync(join(__dirname, "fixtures/fabricated-safety-report.json"), "utf-8");
    expect(fixture).toContain("Wolf eating characters");

    const source = readFileSync(join(__dirname, "../src/runtime/executor.ts"), "utf-8");
    expect(source).not.toContain("Wolf eating characters");
    expect(source).not.toContain("Consistent lighting direction");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -w @studio/gateway -- runtime-executor`
Expected: FAIL — `HANDLERS` is not exported, and the source still contains the wolf text.

- [ ] **Step 4: Delete the handlers**

In `studio/gateway/src/runtime/executor.ts`:

1. Delete `handleSafetyReview` entirely (lines 46-66, the whole function).
2. Delete `handleContinuityCheck` entirely (lines 187-205, the whole function).
3. Remove the `"safety-review": handleSafetyReview,` and `"continuity-check": handleContinuityCheck,` lines from `HANDLERS`.
4. Export the registry so tests can assert on it — change `const HANDLERS` to `export const HANDLERS`.

Add above the registry:

```ts
// ── Handler registry ────────────────────────────────────────────────────────
//
// safety-review and continuity-check are deliberately absent. They used to be
// here and wrote literal findings — a wolf, eight scenes, four passing checks —
// without opening any file belonging to the episode. A stage with a review gate
// and no real checker must stop, not invent a pass; see the dispatcher below.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @studio/gateway -- runtime-executor`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add studio/gateway/src/runtime/executor.ts studio/gateway/test/runtime-executor.test.ts \
        studio/gateway/test/fixtures/fabricated-safety-report.json
git commit -m "gateway: delete the handlers that invented review results

handleSafetyReview described a wolf eating characters and
handleContinuityCheck described eight scenes with four passing checks, for
every episode, having read none of them. The wolf report survives only as a
fixture asserting it can never be produced again."
```

---

### Task 6: Two-gate enforcement and output validation

**Files:**
- Modify: `studio/gateway/src/runtime/client.ts:56-63` (export the builtin-pipelines resolver)
- Modify: `studio/gateway/src/runtime/executor.ts` (`StageResult`, `ExecutionReport`, the dispatch loop)
- Create: `studio/gateway/test/gate-enforcement.test.ts`

**Interfaces:**
- Consumes: `StageGates`, `createDefaultLoader`, `resolvePipeline` from `@studio/runtime` (Task 4); `hashArtifacts`, `buildGateReview` from `@studio/contracts/src/gate-review.mjs` (Task 2).
- Produces: `StageResult.status` widened to `"completed" | "failed" | "skipped" | "blocked" | "awaiting_approval"`.

- [ ] **Step 1: Write the failing tests**

Create `studio/gateway/test/gate-enforcement.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAutopilot } from "../src/runtime/executor.js";
import type { RuntimeClient } from "../src/runtime/client.js";
import { parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINES = resolve(__dirname, "../../pipelines/pipelines");

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

const REF = { channel: "childrens", series: "fairy-tales", episode: "the-run-up" };

async function episode() {
  const root = await mkdtemp(join(tmpdir(), "gw-gates-"));
  roots.push(root);
  const dir = join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
  await mkdir(join(dir, "artifacts"), { recursive: true });
  await mkdir(join(dir, "assets", "images"), { recursive: true });
  vi.stubEnv("AVG_BUILTIN_PIPELINES", PIPELINES);
  return { root, dir };
}

/** A runtime that offers `stageIds` in order, then reports completion. */
function runtimeOffering(...stageIds: string[]): RuntimeClient {
  const queue = [...stageIds];
  return {
    run: vi.fn().mockImplementation(async () => {
      const id = queue.shift();
      return id
        ? { ok: true, data: { stage: { id } } }
        : { ok: true, data: { message: "All stages complete", completed: true } };
    }),
  } as unknown as RuntimeClient;
}

async function journal(dir: string) {
  return parseJournal(await readFile(join(dir, JOURNAL_RELATIVE_PATH), "utf-8"));
}

describe("execution gates", () => {
  it("blocks a stage the manifest says may not run unattended", async () => {
    const { root, dir } = await episode();

    // safety-review declares autopilot: false. It used to run anyway and write
    // a report about a wolf.
    const report = await runAutopilot(
      runtimeOffering("safety-review"), REF, "fairy-tale-adaptation", root, () => {},
    );

    expect(report.stages[0]!.status).toBe("blocked");
    expect(report.stages[0]!.outputs).toEqual([]);

    const events = await journal(dir);
    const requested = events.filter((e) => e.type === "approval-requested");
    expect(requested).toHaveLength(1);
    expect(requested[0]!.detail.stageId).toBe("safety-review");
    expect(requested[0]!.detail.decision).toBe("requested");
  });

  it("never writes a safety report for an episode it did not read", async () => {
    const { root, dir } = await episode();

    await runAutopilot(
      runtimeOffering("safety-review"), REF, "fairy-tale-adaptation", root, () => {},
    );

    await expect(readFile(join(dir, "artifacts", "safety-report.json"), "utf-8")).rejects.toThrow();
  });

  it("blocks a gated stage that has no checker behind it", async () => {
    const { root } = await episode();

    // continuity-check declares autopilot: true but review: human, and nothing
    // actually checks continuity. Blocked, not a fabricated pass.
    const report = await runAutopilot(
      runtimeOffering("continuity-check"), REF, "fairy-tale-adaptation", root, () => {},
    );

    expect(report.stages[0]!.status).toBe("blocked");
  });
});

describe("acceptance gates", () => {
  it("leaves a human-reviewed stage awaiting approval, not completed", async () => {
    const { root, dir } = await episode();
    await writeFile(join(dir, "assets", "images", "s1.png"), "not really a png, but bytes");

    // illustrations declares review: human. It does real work, so it runs — but
    // its result is a candidate, not an accepted one.
    const report = await runAutopilot(
      runtimeOffering("illustrations"), REF, "fairy-tale-adaptation", root, () => {},
    );

    expect(report.stages[0]!.status).toBe("awaiting_approval");
    expect(report.stages[0]!.outputs.length).toBeGreaterThan(0);

    const requested = (await journal(dir)).filter((e) => e.type === "approval-requested");
    expect(requested).toHaveLength(1);
    // The request names what it wants reviewed, by hash.
    expect(requested[0]!.detail.outputs[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never emits an approval of its own", async () => {
    const { root, dir } = await episode();
    await writeFile(join(dir, "assets", "images", "s1.png"), "bytes");

    await runAutopilot(runtimeOffering("illustrations"), REF, "fairy-tale-adaptation", root, () => {});

    // Minting a human approval is avg-qr4.3's problem, and never the gateway's.
    expect((await journal(dir)).filter((e) => e.type === "approval-granted")).toHaveLength(0);
  });

  it("stops the run at the first unaccepted stage", async () => {
    const { root, dir } = await episode();
    await writeFile(join(dir, "assets", "images", "s1.png"), "bytes");

    const report = await runAutopilot(
      runtimeOffering("illustrations", "captions"), REF, "fairy-tale-adaptation", root, () => {},
    );

    // captions would consume illustrations nobody accepted.
    expect(report.stages).toHaveLength(1);
    expect(report.stages[0]!.stageId).toBe("illustrations");
  });
});

describe("output validation", () => {
  it("fails a stage that produced nothing", async () => {
    const { root } = await episode();

    // illustrations with no source images returns an empty output list. That
    // used to be reported as completed.
    const report = await runAutopilot(
      runtimeOffering("illustrations"), REF, "fairy-tale-adaptation", root, () => {},
    );

    expect(report.stages[0]!.status).toBe("failed");
    expect(report.stages[0]!.error).toMatch(/no outputs/i);
  });

  it("fails a stage whose output is an empty file", async () => {
    const { root, dir } = await episode();
    await writeFile(join(dir, "assets", "images", "s1.png"), "");

    const report = await runAutopilot(
      runtimeOffering("illustrations"), REF, "fairy-tale-adaptation", root, () => {},
    );

    expect(report.stages[0]!.status).toBe("failed");
  });
});

describe("the run summary", () => {
  it("counts blocked and awaiting stages so a halt cannot read as a finish", async () => {
    const { root } = await episode();

    const report = await runAutopilot(
      runtimeOffering("safety-review"), REF, "fairy-tale-adaptation", root, () => {},
    );

    expect(report.summary).toMatch(/1 blocked/);
    expect(report.summary).not.toMatch(/^All stages already complete/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @studio/gateway -- gate-enforcement`
Expected: FAIL — stages report `skipped`/`completed`, and no `approval-requested` events exist.

- [ ] **Step 3: Export the builtin-pipelines resolver**

In `studio/gateway/src/runtime/client.ts`, change the private static at line 56 into a module-level exported function so the executor can resolve pipelines the same ADR-0026-compliant way (by package resolution, not path guessing), and have the class call it:

```ts
/**
 * Where the built-in pipeline manifests live.
 *
 * Resolved through the package, never guessed from a relative path: ADR-0026,
 * and the reason the runtime CLI is found the same way.
 */
export function builtinPipelinesPath(): string {
  try {
    const manifest = createRequire(import.meta.url).resolve("@studio/pipelines/package.json");
    return manifest.replace(/package\.json$/, "pipelines");
  } catch {
    return "";
  }
}
```

Replace the body of the existing `private static builtinPipelines()` with `return builtinPipelinesPath();`, leaving its call site at line 191 untouched.

- [ ] **Step 4: Widen the result type and add the gate helpers**

In `studio/gateway/src/runtime/executor.ts`, update the imports:

```ts
import { createDefaultLoader, resolvePipeline, type StageGates } from "@studio/runtime";
import { hashArtifacts, buildGateReview } from "@studio/contracts/src/gate-review.mjs";
import { builtinPipelinesPath } from "./client.js";
```

Change `StageResult.status`:

```ts
export interface StageResult {
  stageId: string;
  status: "completed" | "failed" | "skipped" | "blocked" | "awaiting_approval";
  outputs: string[];
  durationMs: number;
  error?: string;
}
```

Add these helpers above `runAutopilot`:

```ts
/** Gates for every stage in a pipeline, by stage id. */
async function loadGates(
  pipeline: string,
  libraryRoot: string,
  log: (msg: string) => void,
): Promise<Map<string, StageGates> | null> {
  try {
    const loader = createDefaultLoader(libraryRoot, builtinPipelinesPath());
    const resolved = await resolvePipeline(loader, pipeline);
    return new Map(resolved.stages.map((s) => [s.definition.id, s.definition.gates]));
  } catch (err) {
    // Fail closed and loudly. Not knowing what a stage's gates are is not the
    // same as a stage having none, and guessing "none" is how fabricated
    // reviews got reported as completions in the first place.
    log(`Autopilot: cannot read gates for pipeline "${pipeline}" — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Every declared output must exist and have bytes in it.
 *
 * A report file is not proof a review happened, and an empty file is not proof
 * of anything at all. Returns an error message, or null when the outputs hold up.
 */
async function validateOutputs(episodeDir: string, outputs: string[]): Promise<string | null> {
  if (outputs.length === 0) return "the stage produced no outputs";
  for (const file of outputs) {
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      return `declared output "${path.relative(episodeDir, file)}" was not written`;
    }
    if (stat.size === 0) {
      return `declared output "${path.relative(episodeDir, file)}" is empty`;
    }
  }
  return null;
}

/** Ask for a review of what a stage produced, naming it by hash. */
async function requestReview(
  episodeDir: string,
  ref: EpisodeRef,
  stageId: string,
  outputs: string[],
  note: string,
): Promise<void> {
  let hashed: Awaited<ReturnType<typeof hashArtifacts>> = [];
  try {
    hashed = await hashArtifacts(episodeDir, outputs.map((o) => path.relative(episodeDir, o)));
  } catch {
    // A request that cannot name its artifacts is still a request; it simply
    // names none. It can never be satisfied by an approval, which is correct.
    hashed = [];
  }
  await appendJournalEvent(episodeDir, {
    type: "approval-requested",
    actor: "gateway",
    episode: ref,
    stageId,
    detail: buildGateReview({
      stageId,
      decision: "requested",
      actor: "gateway",
      outputs: hashed,
      note,
    }),
  });
}
```

- [ ] **Step 5: Enforce the gates in the dispatch loop**

In `runAutopilot`, load the gates once, immediately after `const ctx: StageContext = ...`:

```ts
  const gates = await loadGates(pipeline, libraryRoot, log);
```

Then replace the handler-lookup block (currently `const handler = HANDLERS[stageId]; if (!handler) { ... break; }`) with:

```ts
    const stageGates = gates?.get(stageId);
    const gated = stageGates === undefined || !stageGates.autopilot || stageGates.review !== "none";

    // 1. The manifest says this may not run unattended.
    if (stageGates && !stageGates.autopilot) {
      log(`Autopilot: "${stageId}" declares autopilot: false — approval requested`);
      await requestReview(episodeDir, ref, stageId, [], `${stageId} declares autopilot: false`);
      results.push({ stageId, status: "blocked", outputs: [], durationMs: 0,
        error: "Stage declares autopilot: false and may not run unattended" });
      break;
    }

    const handler = HANDLERS[stageId];

    // 2. No checker behind a gated stage. A refusal, not a shrug.
    if (!handler) {
      if (gated) {
        const why = stageGates
          ? `"${stageId}" requires ${stageGates.review} review and has no checker`
          : `gates for "${stageId}" could not be read`;
        log(`Autopilot: ${why} — blocked`);
        await requestReview(episodeDir, ref, stageId, [], why);
        results.push({ stageId, status: "blocked", outputs: [], durationMs: 0, error: why });
      } else {
        log(`Autopilot: no handler for "${stageId}" — skipping`);
        results.push({ stageId, status: "skipped", outputs: [], durationMs: 0,
          error: "No handler registered" });
      }
      break;
    }
```

Then, inside the `try` after `const outputs = await handler(ctx);`, replace the unconditional `results.push({ ..., status: "completed", ... })` and its `stage-completed` event with:

```ts
      // 3. File existence is discovery, not completion.
      const invalid = await validateOutputs(episodeDir, outputs);
      if (invalid) {
        results.push({ stageId, status: "failed", outputs: [], durationMs: Date.now() - stageStart,
          error: invalid });
        await appendJournalEvent(episodeDir, {
          type: "stage-failed", actor: "runtime", episode: ref, stageId,
          detail: { durationMs: Date.now() - stageStart, error: invalid },
        });
        log(`Autopilot: ${stageId} FAILED — ${invalid}`);
        break;
      }

      const relative = outputs.map((o) => path.relative(episodeDir, o));

      // 4. Ran, but not accepted.
      if (stageGates && stageGates.review !== "none") {
        await requestReview(episodeDir, ref, stageId, outputs,
          `${stageId} requires ${stageGates.review} review`);
        results.push({ stageId, status: "awaiting_approval", outputs, durationMs: Date.now() - stageStart });
        await appendJournalEvent(episodeDir, {
          type: "attempt-recorded", actor: "runtime", episode: ref, stageId,
          detail: { durationMs: Date.now() - stageStart, outputs: relative },
        });
        log(`Autopilot: ${stageId} awaiting ${stageGates.review} review — stopping`);
        break;
      }

      // 5. Ungated and its outputs hold up.
      results.push({ stageId, status: "completed", outputs, durationMs: Date.now() - stageStart });
      await appendJournalEvent(episodeDir, {
        type: "stage-completed", actor: "runtime", episode: ref, stageId,
        detail: { durationMs: Date.now() - stageStart, outputs: relative },
      });
```

- [ ] **Step 6: Report the halt in the summary**

Replace the summary construction at the end of `runAutopilot`:

```ts
  const totalMs = Date.now() - startMs;
  const count = (status: StageResult["status"]) => results.filter((r) => r.status === status).length;
  const parts = [
    `${count("completed")} completed`,
    `${count("failed")} failed`,
  ];
  // A run that halted at a gate is not a run that finished.
  if (count("awaiting_approval") > 0) parts.push(`${count("awaiting_approval")} awaiting review`);
  if (count("blocked") > 0) parts.push(`${count("blocked")} blocked`);

  return {
    episodeSlug: `${ref.channel}/${ref.series}/${ref.episode}`,
    pipeline,
    stages: results,
    totalDurationMs: totalMs,
    summary: results.length === 0
      ? `All stages already complete (${(totalMs / 1000).toFixed(1)}s)`
      : `${parts.join(", ")}, ${results.length} total (${(totalMs / 1000).toFixed(1)}s)`,
  };
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -w @studio/gateway -- gate-enforcement`
Expected: PASS, all ten tests.

- [ ] **Step 8: Run the full gateway suite and typecheck**

Run: `npm test -w @studio/gateway && npm run typecheck -w @studio/gateway`
Expected: PASS. The pre-existing 2/156 gateway failures (`GET /health`, `GET /ws` token rejection, recorded in `avg-86w`) are unrelated to this work and may still fail — confirm they are the same two and no others.

- [ ] **Step 9: Commit**

```bash
git add studio/gateway/src/runtime/executor.ts studio/gateway/src/runtime/client.ts \
        studio/gateway/test/gate-enforcement.test.ts
git commit -m "gateway: honour the gates the manifests already declared

autopilot gates execution, review gates acceptance, and declared outputs
must exist and have bytes before a stage may claim completion. The gateway
asks for approvals and never grants one."
```

---

## Self-Review

**Spec coverage:**

| spec section | task |
|---|---|
| 1. Gate-review contract | 1 (schema, fixtures, bindings), 2 (`hashArtifacts`, `buildGateReview`) |
| 2. Invalidation by re-hashing | 3 (`deriveGateState`) |
| 3. Delete the fabricating handlers | 5 |
| 4. Two gates, enforced separately | 4 (gates survive the loader), 6 (dispatcher) |
| 4a. Run stops at first gated stage | 6, "stops the run at the first unaccepted stage" |
| 5. Gateway does not mint approvals | 6, "never emits an approval of its own" |
| 6. Run summary | 6 steps 6 and the summary test |
| Testing section, all seven criteria | 5 (wolf, registry), 6 (gates, outputs), 3 (invalidation) |

**Gap found and closed during review:** the spec's file table lists only `studio/contracts` and `studio/gateway` files, but the gates are discarded in `studio/runtime/src/pipeline/fs-loader.ts`. Without Task 4 the executor has nothing to read. Task 4 is therefore new relative to the spec's file list, and the spec's table should be treated as incomplete rather than as a boundary.

**Deliberately deferred from the spec's test list:** "with `@av/video-composer` failing to import, QA cannot produce a pass." `handleQa` already degrades honestly in that case (it reports `warn` with a measured duration or no checks at all), and under Task 6 the `qa` stage ends `awaiting_approval` regardless of its internal verdict, because `qa` declares `review: human`. The criterion is satisfied by construction. If the reviewer wants it pinned explicitly, add a test that stubs the import failure and asserts `status === "awaiting_approval"` and `verdict !== "pass"`.

**Type consistency:** `StageGates` — `{ autopilot, review, retryOnFailure }` — is defined in Task 4 and consumed in Task 6 with those names. `hashArtifacts`/`buildGateReview` signatures in Task 2 match their call sites in Tasks 3 and 6. `GateReview.decision` is `"requested" | "approved"` in the schema (Task 1), the runtime guard (Task 2) and the `.d.mts` (Task 2). `HANDLERS` is exported in Task 5 and read in Task 6.

## Risks

- **`StageDefinition.gates` is required, not optional.** Adding it may break test fixtures in `studio/runtime` that build stage literals. Task 4 step 6 says to fix the fixtures, not to make the field optional — an optional gate is a gate that can be forgotten, which is how this bug survived.
- **Gateway tests import `@studio/runtime` through `dist/`.** Task 4 must run `npm run build -w @studio/runtime` (step 7) or Task 6's imports resolve to a stale build with no `createDefaultLoader`.
- **Pipeline resolution failure now blocks everything.** `loadGates` returning `null` makes every stage gated. That is the fail-closed choice and it is logged explicitly, but it means a broken `@studio/pipelines` resolution turns into "everything blocked" rather than "everything runs." The log line is the thing to look for when diagnosing that.
- **Autopilot visibly stops earlier than before.** `safety-review` blocks, `illustrations` and `qa` end awaiting review. A demo that appeared to run end-to-end will now halt. That is the point of the change, but it will read as a regression to anyone expecting the old output — say so in the issue's closing note.
