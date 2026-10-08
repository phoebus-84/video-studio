# vpr Runs the Declared Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `avg-sxk`. `vpr` runs the pipeline the library declares for an episode (`pipeline.yaml` in the episode, series or channel), and finds the built-in pipelines without `AVG_BUILTIN_PIPELINES`.

**Architecture:**
- **Runtime:** `declaredPipeline(libraryRoot, ref)` in `studio/runtime/src/pipeline/declared.ts`, exported from `@studio/runtime`.
- **CLI:**
  - `pipelineFor(ctx, args, ref, explicit)` replaces every `pipelineName ?? DEFAULT_PIPELINE`.
  - `builtinPipelines()` resolves `@studio/pipelines` when the env variable is unset.
- **Agent:** Pi's manifest lists every built-in pipeline.
- **Docs:** `docs/running.md`.

**Tech Stack:** TypeScript, js-yaml 5, vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-declared-pipeline-design.md`, on this branch.

Prototype: the local commit `3f27073` on `scratch/declared-pipeline`. Never push or merge it. It passed:
- runtime 680 tests;
- the root `npm run check`.

## Global Constraints

- Work on branch `fix/declared-pipeline`, in the main checkout.
- Never push or merge without the user's go.
- **Never stage `.beads/`, `studio/gateway/src/workspace/filesystem-service.ts` or `studio/gateway/test/workspace-filesystem.test.ts`.**
  - They hold the user's unrelated local changes. Leave them as they are, and never `git stash`.
  - Never run `bd`.
  - Use explicit `git add` paths.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code goes in exactly as shown. No dependency changes.
- The CLI tests spawn `dist/src/cli.js`. Run `npm run build --workspace @studio/runtime` before them; `npm test` in `studio/runtime` does it itself (`pretest`).
- `ls` in this shell can hang. Use `/bin/ls`.

## Review Focus

- **A declaration never silently falls back.** A `pipeline.yaml` that doesn't parse, isn't a mapping, or names a non-id (`../x`) is an error naming the file. Task 1 pins this.
- **An empty or comment-only `pipeline.yaml` declares nothing.** It is not an error: js-yaml 5 throws on an empty document. Task 1 pins this.
- **`--pipeline` still wins.** Task 2 pins this.
- **A bad declaration claims nothing.** `vpr run` exits 2 before composing the service. Task 2 pins this.
- **A library's own pipeline overrides a built-in of the same id.** The loader scans the built-ins first and the library last; that order is unchanged, and the existing `cli.test.ts` shadowing tests pin it.

---

### Task 1: The declaration, read by the runtime

**Files:**
- Create:
  - `studio/runtime/src/pipeline/declared.ts`;
  - `studio/runtime/test/unit/pipeline/declared.test.ts`.
- Modify:
  - `studio/runtime/src/pipeline/index.ts`;
  - `studio/runtime/src/index.ts`.

**Interfaces:**
- Produces:
  - `declaredPipeline(libraryRoot: string, ref: {channel, series, episode}): {name, file} | null`;
  - `PipelineDeclarationError`, with `code: "bad-declaration" | "bad-name"` and `file`;
  - both exported from `@studio/runtime`, together with the type `DeclaredPipeline`.

- [ ] **Step 1: Write the failing test.**

Create `studio/runtime/test/unit/pipeline/declared.test.ts`:

````ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { channelPath, episodePath, seriesPath } from "@studio/contracts/src/layout.mjs";
import { declaredPipeline, PipelineDeclarationError } from "../../../src/pipeline/declared.js";

/** The pipeline the library declares for an episode (avg-sxk). */

const REF = { channel: "dentro-i-versi", series: "long", episode: "il-lampo" };
let root: string;
const at = {
  episode: () => episodePath(root, REF.channel, REF.series, REF.episode),
  series: () => seriesPath(root, REF.channel, REF.series),
  channel: () => channelPath(root, REF.channel),
};
function declare(level: keyof typeof at, body: string) {
  mkdirSync(at[level](), { recursive: true });
  writeFileSync(join(at[level](), "pipeline.yaml"), body);
}
function refusal(): PipelineDeclarationError {
  try {
    declaredPipeline(root, REF);
  } catch (e) {
    if (e instanceof PipelineDeclarationError) return e;
    throw e;
  }
  throw new Error("expected a PipelineDeclarationError");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "declared-pipeline-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("declaredPipeline", () => {
  it("answers null when nothing declares one", () => {
    mkdirSync(at.episode(), { recursive: true });
    expect(declaredPipeline(root, REF)).toBeNull();
  });

  it("takes the channel's, the series' over it, and the episode's over both", () => {
    declare("channel", "pipeline: narrated-illustrated-video\n");
    expect(declaredPipeline(root, REF)).toEqual({ name: "narrated-illustrated-video", file: "dentro-i-versi/pipeline.yaml" });
    declare("series", "# the series family\npipeline: series-production\n");
    expect(declaredPipeline(root, REF)).toEqual({ name: "series-production", file: "dentro-i-versi/series/long/pipeline.yaml" });
    declare("episode", "pipeline: blender-animation\n");
    expect(declaredPipeline(root, REF)).toEqual({ name: "blender-animation", file: "dentro-i-versi/series/long/episodes/il-lampo/pipeline.yaml" });
  });

  it("skips a file without the key, an empty one and a comment-only one", () => {
    declare("channel", "pipeline: series-production\n");
    declare("series", "settings:\n  voice: serena\n");
    declare("episode", "");
    expect(declaredPipeline(root, REF)?.name).toBe("series-production");
    declare("episode", "# nothing yet\n\n");
    expect(declaredPipeline(root, REF)?.name).toBe("series-production");
  });

  it("refuses a file that does not parse, naming it", () => {
    declare("channel", "pipeline: series-production\n");
    declare("series", "pipeline: [unclosed\n");
    const e = refusal();
    expect([e.code, e.file]).toEqual(["bad-declaration", "dentro-i-versi/series/long/pipeline.yaml"]);
  });

  it("refuses a file that is not a mapping", () => {
    declare("series", "- series-production\n");
    expect(refusal().code).toBe("bad-declaration");
  });

  it("refuses a name that is not a pipeline id", () => {
    for (const name of ["../x", "Series Production", "42"]) {
      declare("series", `pipeline: ${name}\n`);
      expect(refusal().code).toBe("bad-name");
    }
    declare("series", "pipeline: 42\n");
    expect(refusal().message).toContain("42");
  });
});
````

- [ ] **Step 2: Run it, and see it fail.** `cd studio/runtime && npx vitest run test/unit/pipeline/declared.test.ts`. Expect the module not to be found.

- [ ] **Step 3: Implement.**

Create `studio/runtime/src/pipeline/declared.ts`:

````ts
// ---------------------------------------------------------------------------
// The pipeline the library declares for an episode (avg-sxk)
// ---------------------------------------------------------------------------
// An episode's pipeline is the `pipeline:` key of a `pipeline.yaml` in the
// episode, else its series, else its channel. The first file that names one
// wins. A file that doesn't parse, or names something that isn't a pipeline
// id, is an error naming the file: guessing past it would run another
// pipeline's stages on the episode.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { channelPath, episodePath, seriesPath } from "@studio/contracts/src/layout.mjs";

export interface DeclaredPipeline {
  /** The pipeline id. */
  name: string;
  /** The declaring file, relative to the library root. */
  file: string;
}

export class PipelineDeclarationError extends Error {
  constructor(
    readonly code: "bad-declaration" | "bad-name",
    message: string,
    readonly file: string,
  ) {
    super(message);
    this.name = "PipelineDeclarationError";
  }
}

const PIPELINE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function declaredPipeline(
  libraryRoot: string,
  ref: { channel: string; series: string; episode: string },
): DeclaredPipeline | null {
  const dirs = [
    episodePath(libraryRoot, ref.channel, ref.series, ref.episode),
    seriesPath(libraryRoot, ref.channel, ref.series),
    channelPath(libraryRoot, ref.channel),
  ];
  for (const dir of dirs) {
    const absolute = path.join(dir, "pipeline.yaml");
    const file = path.relative(libraryRoot, absolute);
    let raw: string;
    try {
      raw = readFileSync(absolute, "utf-8");
    } catch {
      continue;
    }
    // An empty or comment-only file declares nothing (js-yaml 5 refuses an empty document).
    if (!raw.split("\n").some((line) => line.trim() !== "" && !line.trim().startsWith("#"))) continue;
    let doc: unknown;
    try {
      doc = loadYaml(raw);
    } catch (e) {
      throw new PipelineDeclarationError("bad-declaration", `${file} does not parse: ${e instanceof Error ? e.message : String(e)}`, file);
    }
    if (doc === null || doc === undefined) continue;
    if (typeof doc !== "object" || Array.isArray(doc)) {
      throw new PipelineDeclarationError("bad-declaration", `${file} is not a mapping`, file);
    }
    const name = (doc as Record<string, unknown>).pipeline;
    if (name === undefined || name === null) continue;
    if (typeof name !== "string" || !PIPELINE_ID.test(name)) {
      throw new PipelineDeclarationError("bad-name", `${file} declares pipeline ${JSON.stringify(name)}, which is not a pipeline id`, file);
    }
    return { name, file };
  }
  return null;
}
````

````diff
diff --git a/studio/runtime/src/index.ts b/studio/runtime/src/index.ts
index a02558b..d54e6c3 100644
--- a/studio/runtime/src/index.ts
+++ b/studio/runtime/src/index.ts
@@ -124,6 +124,8 @@ export {
   InMemoryPipelineLoader,
   FileSystemPipelineLoader,
   createDefaultLoader,
+  declaredPipeline,
+  PipelineDeclarationError,
   createSnapshot,
   computeSnapshotHash,
   validateSnapshot,
@@ -132,6 +134,7 @@ export {
   InMemorySnapshotStore,
 } from "./pipeline/index.js";
 export type {
+  DeclaredPipeline,
   ResolveOptions,
   CapabilityRequest,
   ArtifactRef,
diff --git a/studio/runtime/src/pipeline/index.ts b/studio/runtime/src/pipeline/index.ts
index 29b1224..9e5440c 100644
--- a/studio/runtime/src/pipeline/index.ts
+++ b/studio/runtime/src/pipeline/index.ts
@@ -10,6 +10,8 @@ export type { ResolveOptions } from "./resolver.js";
 
 export { InMemoryPipelineLoader } from "./fixture-loader.js";
 export { FileSystemPipelineLoader, createDefaultLoader } from "./fs-loader.js";
+export { declaredPipeline, PipelineDeclarationError } from "./declared.js";
+export type { DeclaredPipeline } from "./declared.js";
 
 export { InMemorySnapshotStore } from "./fixture-store.js";
 
````

- [ ] **Step 4: Run it, and see it pass.**
  - The test passes, 6 tests.
  - `npx tsc --noEmit -p studio/runtime` at the root is clean.

- [ ] **Step 5: Commit.**

```bash
git add studio/runtime/src/pipeline/declared.ts studio/runtime/test/unit/pipeline/declared.test.ts studio/runtime/src/pipeline/index.ts studio/runtime/src/index.ts
git commit -m "Runtime: the pipeline the library declares for an episode (avg-sxk)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: vpr uses it, and finds the built-ins

**Files:**
- Create: `studio/runtime/test/integration/cli-declared-pipeline.test.ts`.
- Modify:
  - `studio/runtime/src/cli.ts`;
  - `studio/agent/src/agent.ts`;
  - `docs/running.md`.

**Interfaces:**
- Consumes: Task 1's `declaredPipeline` and `PipelineDeclarationError`.
- Produces:
  - `pipelineFor(ctx, args, ref, explicit): string | number`, which answers the pipeline or an exit code it already reported;
  - `builtinPipelines(): string | undefined`.

- [ ] **Step 1: Write the failing test.**

Create `studio/runtime/test/integration/cli-declared-pipeline.test.ts`:

````ts
// ---------------------------------------------------------------------------
// `vpr` runs the pipeline the library declares (avg-sxk), and finds the
// built-in pipelines without AVG_BUILTIN_PIPELINES. Spawns the compiled CLI,
// like cli.test.ts: run through `npm test`, whose `pretest` rebuilds dist/.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { reviewChainPipeline } from "../unit/execution/helpers/review-chain.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../../dist/src/cli.js");
const EP = "dentro-i-versi/long/il-lampo";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

/** A library whose series declares `pipeline`. */
async function library(pipeline: string) {
  const root = await mkdtemp(path.join(tmpdir(), "cli-declared-"));
  roots.push(root);
  const series = path.join(root, "dentro-i-versi", "series", "long");
  await mkdir(path.join(series, "episodes", "il-lampo"), { recursive: true });
  await writeFile(path.join(series, "pipeline.yaml"), `pipeline: ${pipeline}\n`);
  return root;
}

function vpr(root: string, args: string[], builtins?: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AVG_OPERATOR_KEY_FILE: path.join(tmpdir(), "vpr-cli-no-operator-key"),
  };
  delete env.AVG_BUILTIN_PIPELINES;
  delete env.AVG_LIBRARY_ROOT;
  if (builtins) env.AVG_BUILTIN_PIPELINES = builtins;
  const result = spawnSync("node", [cliPath, ...args, "--library", root, "--json"], {
    encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], env,
  });
  return { status: result.status ?? 1, json: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}

describe("vpr and the declared pipeline", () => {
  it("reports the pipeline the series declares, with no --pipeline", async () => {
    const root = await library("review-chain");
    const status = vpr(root, ["status", EP], await reviewChainPipeline(roots));
    expect(status.status).toBe(0);
    expect(status.json.pipeline).toBe("review-chain");
    expect(status.json.stages.map((s: { stageId: string }) => s.stageId)).toContain("upstream");
  });

  it("lets --pipeline win over the declaration", async () => {
    const root = await library("not-installed");
    const status = vpr(root, ["status", EP, "--pipeline", "review-chain"], await reviewChainPipeline(roots));
    expect(status.status).toBe(0);
    expect(status.json.pipeline).toBe("review-chain");
  });

  it("refuses a declaration it cannot read, and claims nothing", async () => {
    const root = await library("../escape");
    const run = vpr(root, ["run", EP], await reviewChainPipeline(roots));
    expect([run.status, run.json.code]).toEqual([2, "bad-name"]); // EX_RUNTIME
    expect(run.json.error).toContain("dentro-i-versi/series/long/pipeline.yaml");
  });

  it("finds the built-in pipelines without AVG_BUILTIN_PIPELINES", async () => {
    const root = await library("series-production");
    const status = vpr(root, ["status", EP]);
    expect(status.status).toBe(0);
    expect(status.json.pipeline).toBe("series-production");
    expect(status.json.stages.map((s: { stageId: string }) => s.stageId)).toContain("spec");
  });
});
````

- [ ] **Step 2: Run it, and see it fail.**
  - Run `npm run build --workspace @studio/runtime`, then `cd studio/runtime && npx vitest run test/integration/cli-declared-pipeline.test.ts`.
  - Expect three failures:
    - the declared pipeline is ignored;
    - the bad declaration isn't refused;
    - the built-ins aren't found.
  - "--pipeline wins" passes already.

- [ ] **Step 3: Implement.**

````diff
diff --git a/docs/running.md b/docs/running.md
index 98b0a1e..f5482e0 100644
--- a/docs/running.md
+++ b/docs/running.md
@@ -275,6 +275,15 @@ through the same service, so a stage claimed in one is visible to the rest.
 
 Every command below takes `--library <path>` (see section 0) and `--json`.
 
+**Which pipeline.** A command runs the pipeline the library declares for the
+episode: the `pipeline:` key of `pipeline.yaml` in the episode, else its
+series, else its channel, the same lookup the gateway does. With no
+declaration it runs `narrated-illustrated-video`; `--pipeline <name>` overrides
+both. A `pipeline.yaml` that doesn't parse, or names something that isn't a
+pipeline id, fails the command (exit 2) without claiming anything. The built-in
+pipelines are found through `@studio/pipelines`; `AVG_BUILTIN_PIPELINES`
+points elsewhere.
+
 **`vpr run`** claims the next runnable stage — or the one named by `--stage` —
 and prints the command that closes it:
 
@@ -531,6 +540,7 @@ the same absolute path for every process that needs to be the operator.
 | `AVG_GATEWAY_URL` | `http://127.0.0.1:5198` | Gateway to stream events to |
 | `AVG_GATEWAY_TOKEN` | `library/.gateway-token` | Gateway auth |
 | `AVG_OPERATOR_KEY_FILE` | gateway: `.operator-key` in its cwd; `vpr`: `studio/gateway/.operator-key` | Which file makes a caller the operator — see "The operator key" above |
+| `AVG_BUILTIN_PIPELINES` | `@studio/pipelines`' `pipelines/` | Where `vpr` finds the built-in pipelines |
 | `AVG_HEADLESS` | unset (the gateway sets `1` for Pi) | Any value but empty or `0` makes `vpr` an agent without reading the operator key |
 | `FAL_KEY` | — | Required for `image.generate` / `image.edit` |
 | `AVG_TTS_WORKER_URL` | local worker | Speech synthesis endpoint |
diff --git a/studio/agent/src/agent.ts b/studio/agent/src/agent.ts
index 47fb2c4..5ca02ea 100644
--- a/studio/agent/src/agent.ts
+++ b/studio/agent/src/agent.ts
@@ -58,9 +58,11 @@ const CAPABILITIES = {
     "qa-check",
   ],
   pipelines: [
+    "blender-animation",
     "fairy-tale-adaptation",
     "narrated-illustrated-video",
     "repository-documentation",
+    "series-production",
   ],
 };
 
diff --git a/studio/runtime/src/cli.ts b/studio/runtime/src/cli.ts
index 3b2a3d0..911b234 100644
--- a/studio/runtime/src/cli.ts
+++ b/studio/runtime/src/cli.ts
@@ -34,6 +34,8 @@ import { reviewSheet, sheetReviewStatus } from "./sheet-review.js";
 import { releaseTemplate, sealTheme, ThemeReleaseError } from "./theme-release.js";
 import { verifySeriesReference } from "@studio/contracts/src/series-references.mjs";
 import { channelPath, seriesPath } from "@studio/contracts/src/layout.mjs";
+import { createRequire } from "node:module";
+import { declaredPipeline, PipelineDeclarationError } from "./pipeline/declared.js";
 import type { RerunMode } from "./rerun/index.js";
 import { err, ok } from "./result.js";
 import type { Result } from "./result.js";
@@ -45,6 +47,7 @@ const EX_USAGE = 1;
 const EX_RUNTIME = 2;
 const EX_INVALID = 3;
 
+/** The pipeline of an episode that neither `--pipeline` nor the library names. */
 const DEFAULT_PIPELINE = "narrated-illustrated-video";
 
 // ── Types ───────────────────────────────────────────────────────────────────
@@ -121,7 +124,7 @@ function makeSnapshotStore(libraryRoot: string): FileSystemSnapshotStore {
 function makeLoader(args: string[] = []): PipelineLoader {
   const libraryRoot = libraryFrom(args);
   if (libraryRoot) {
-    return createDefaultLoader(libraryRoot) as unknown as PipelineLoader;
+    return createDefaultLoader(libraryRoot, builtinPipelines()) as unknown as PipelineLoader;
   }
   return new InMemoryPipelineLoader() as unknown as PipelineLoader;
 }
@@ -274,6 +277,8 @@ async function cmdResolve(ctx: CliContext, args: string[]): Promise<number> {
     emit(ctx, { error: `Invalid path "${remaining[0]}". Expected: <channel>/<series>/<episode>` });
     return EX_USAGE;
   }
+  const pipelineId = pipelineFor(ctx, args, parsed, pipelineName);
+  if (typeof pipelineId === "number") return pipelineId;
   try {
     const { settings, report } = resolveSettings({
       channel: emptyLayer(),
@@ -281,7 +286,7 @@ async function cmdResolve(ctx: CliContext, args: string[]): Promise<number> {
       episode: emptyLayer(),
     });
     const loader = makeLoader(args);
-    const pipeline = await resolvePipeline(loader, pipelineName ?? DEFAULT_PIPELINE);
+    const pipeline = await resolvePipeline(loader, pipelineId);
     const episodeSlug = `${parsed.channel}/${parsed.series}/${parsed.episode}`;
     const libraryRoot = libraryFrom(args);
     const store = libraryRoot ? makeSnapshotStore(libraryRoot) : null;
@@ -340,8 +345,10 @@ async function cmdStatus(ctx: CliContext, args: string[]): Promise<number> {
 
   const operatorKey = cliOperatorKey(ctx);
   if (typeof operatorKey === "number") return operatorKey;
+  const pipeline = pipelineFor(ctx, args, parsed, pipelineName);
+  if (typeof pipeline === "number") return pipeline;
   const service = makeService(args, ttl.value, operatorKey);
-  const status = await service.status(parsed, pipelineName ?? DEFAULT_PIPELINE);
+  const status = await service.status(parsed, pipeline);
   if (!status.ok) {
     emit(ctx, { error: `${status.error.code}: ${status.error.message}` });
     return exitCodeFor(status.error);
@@ -407,7 +414,8 @@ async function cmdPin(ctx: CliContext, args: string[]): Promise<number> {
     return EX_USAGE;
   }
   const service = makeService(args, ttl.value, null);
-  const pipeline = pipelineName ?? DEFAULT_PIPELINE;
+  const pipeline = pipelineFor(ctx, args, parsed, pipelineName);
+  if (typeof pipeline === "number") return pipeline;
 
   if (sub === "verify") {
     const pins = await service.verifyPins(parsed);
@@ -555,7 +563,9 @@ async function cmdValidate(ctx: CliContext, args: string[]): Promise<number> {
     try {
       resolveSettings({ channel: emptyLayer(), series: emptyLayer(), episode: emptyLayer() });
       const loader = makeLoader(args);
-      const pipeline = await resolvePipeline(loader, DEFAULT_PIPELINE);
+      const pipelineId = pipelineFor(ctx, args, parsed, extractPipeline(args).pipeline);
+      if (typeof pipelineId === "number") return pipelineId;
+      const pipeline = await resolvePipeline(loader, pipelineId);
       emit(ctx, {
         message: "Pipeline validation passed",
         valid: true,
@@ -642,7 +652,8 @@ async function cmdRerun(ctx: CliContext, args: string[]): Promise<number> {
   const operatorKey = cliOperatorKey(ctx);
   if (typeof operatorKey === "number") return operatorKey;
   const service = makeService(args, ttl.value, operatorKey);
-  const pipeline = pipelineName ?? DEFAULT_PIPELINE;
+  const pipeline = pipelineFor(ctx, args, parsed, pipelineName);
+  if (typeof pipeline === "number") return pipeline;
 
   const plan = await service.planRerun(parsed, pipeline, mode as RerunMode, selected);
   if (!plan.ok) {
@@ -741,7 +752,8 @@ async function cmdReview(ctx: CliContext, args: string[], decision: "approved" |
 
   const service = makeService(args, ttl.value, credential.operatorKey);
   const { pipeline: pipelineName } = extractPipeline(args);
-  const pipeline = pipelineName ?? DEFAULT_PIPELINE;
+  const pipeline = pipelineFor(ctx, args, parsed, pipelineName);
+  if (typeof pipeline === "number") return pipeline;
   const out = await service.review(parsed, pipeline, stageId, { decision, principal: credential.principal, note });
   if (!out.ok) {
     emit(ctx, { error: out.error.message, code: out.error.code });
@@ -1023,8 +1035,10 @@ async function cmdTakes(ctx: CliContext, args: string[]): Promise<number> {
     emit(ctx, { error: ttl.error });
     return EX_USAGE;
   }
+  const pipeline = pipelineFor(ctx, args, parsed, pipelineName);
+  if (typeof pipeline === "number") return pipeline;
   const service = makeService(args, ttl.value, operatorKey);
-  const takes = await service.takes(parsed, pipelineName ?? DEFAULT_PIPELINE);
+  const takes = await service.takes(parsed, pipeline);
   if (!takes.ok) {
     emit(ctx, { error: `${takes.error.code}: ${takes.error.message}` });
     return exitCodeFor(takes.error);
@@ -1083,8 +1097,10 @@ async function cmdSelect(ctx: CliContext, args: string[]): Promise<number> {
     emit(ctx, { error: ttl.error });
     return EX_USAGE;
   }
+  const pipeline = pipelineFor(ctx, args, parsed, pipelineName);
+  if (typeof pipeline === "number") return pipeline;
   const service = makeService(args, ttl.value, credential.operatorKey);
-  const out = await service.select(parsed, pipelineName ?? DEFAULT_PIPELINE, stageId, {
+  const out = await service.select(parsed, pipeline, stageId, {
     attemptNumber, principal: credential.principal, ...(expected !== undefined ? { expected } : {}),
   });
   if (!out.ok) {
@@ -1121,6 +1137,46 @@ function cliOperatorKey(ctx: CliContext): string | null | number {
   }
 }
 
+/**
+ * The pipeline a command runs on an episode (avg-sxk): `--pipeline`, else
+ * the one the library declares (`pipeline.yaml` in the episode, series or
+ * channel — what the gateway reads too), else `DEFAULT_PIPELINE`. A
+ * declaration that can't be read is an error, never the default: the default
+ * would run another pipeline's stages on the episode.
+ */
+function pipelineFor(
+  ctx: CliContext,
+  args: string[],
+  ref: { channel: string; series: string; episode: string },
+  explicit: string | undefined,
+): string | number {
+  if (explicit) return explicit;
+  try {
+    return declaredPipeline(libraryFrom(args) || ".", ref)?.name ?? DEFAULT_PIPELINE;
+  } catch (e) {
+    if (!(e instanceof PipelineDeclarationError)) throw e;
+    emit(ctx, { error: `${e.message}. Nothing was recorded.`, code: e.code });
+    return EX_RUNTIME;
+  }
+}
+
+/**
+ * Where the built-in pipeline manifests live: `AVG_BUILTIN_PIPELINES` when
+ * the operator sets it, else `@studio/pipelines`' directory, resolved through
+ * the package as the gateway resolves it (ADR-0026). The CLI is a
+ * composition root, like the gateway; the runtime library itself still takes
+ * the path as a parameter (`createDefaultLoader`).
+ */
+function builtinPipelines(): string | undefined {
+  if (process.env.AVG_BUILTIN_PIPELINES) return process.env.AVG_BUILTIN_PIPELINES;
+  try {
+    const manifest = createRequire(import.meta.url).resolve("@studio/pipelines/package.json");
+    return manifest.replace(/package\.json$/, "pipelines");
+  } catch {
+    return undefined;
+  }
+}
+
 /**
  * The execution service, composed for the CLI.
  *
@@ -1137,7 +1193,7 @@ function makeService(args: string[], leaseTtlMs: number, operatorKey: string | n
     // gateway's production.ts: an empty string is not nullish, so it does not
     // trigger `createDefaultLoader`'s `??` fallback — the operator's escape
     // hatch would be dead exactly when it is reached for.
-    builtinPipelines: process.env.AVG_BUILTIN_PIPELINES || undefined,
+    builtinPipelines: builtinPipelines(),
     // The journal's spend ledger (avg-91o), the same guard the gateway
     // composes: a stage that declares a paid capability is refused once the
     // episode's budget is used up. It reserves nothing — the paid call does.
@@ -1166,7 +1222,7 @@ function makeService(args: string[], leaseTtlMs: number, operatorKey: string | n
 function serviceLoader(args: string[]): PipelineLoader {
   return createDefaultLoader(
     libraryFrom(args) || ".",
-    process.env.AVG_BUILTIN_PIPELINES || undefined,
+    builtinPipelines(),
   ) as unknown as PipelineLoader;
 }
 
@@ -1374,8 +1430,10 @@ async function cmdRun(ctx: CliContext, args: string[]): Promise<number> {
     return EX_RUNTIME;
   }
 
+  const pipeline = pipelineFor(ctx, args, parsed, pipelineName);
+  if (typeof pipeline === "number") return pipeline;
   const service = makeService(args, ttl.value, credential.operatorKey);
-  const claimed = await service.claim(parsed, pipelineName ?? DEFAULT_PIPELINE, {
+  const claimed = await service.claim(parsed, pipeline, {
     ...(stage ? { stage } : {}),
     dryRun: ctx.dryRun,
     principal: credential.principal,
@@ -1465,7 +1523,8 @@ async function cmdComplete(ctx: CliContext, args: string[]): Promise<number> {
     return EX_USAGE;
   }
   const stageId = positional[1]!;
-  const pipeline = pipelineName ?? DEFAULT_PIPELINE;
+  const pipeline = pipelineFor(ctx, args, parsed, pipelineName);
+  if (typeof pipeline === "number") return pipeline;
 
   const flag = (name: string): string | undefined => {
     const i = remaining.indexOf(name);
````

- [ ] **Step 4: Run them, and see them pass.**
  - `npm run build --workspace @studio/runtime`.
  - `cd studio/runtime && npx vitest run`: all pass, including the 4 new tests.
  - `npx eslint src/pipeline/declared.ts src/cli.ts test/unit/pipeline/declared.test.ts test/integration/cli-declared-pipeline.test.ts`: 0 errors.
  - `npx tsc --noEmit -p studio/agent` at the root.
  - At the root, `npm run check`.

- [ ] **Step 5: Commit.**

```bash
git add studio/runtime/test/integration/cli-declared-pipeline.test.ts studio/runtime/src/cli.ts studio/agent/src/agent.ts docs/running.md
git commit -m "vpr runs the pipeline the library declares, and finds the built-in pipelines itself (avg-sxk)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
