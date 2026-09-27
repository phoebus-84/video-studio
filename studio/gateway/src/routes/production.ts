// ── Production Routes ───────────────────────────────────────────────────────
//
// Orchestration endpoints that map Pi agent tools to the pipeline runtime.
// All POST/DELETE operations require authentication.
// GET operations are read-only projections.

import type { FastifyInstance } from "fastify";
import type { RuntimeClient, EpisodeRef } from "../runtime/client.js";
import type { WorkspaceService } from "../workspace/service.js";
import { ErrorCode, GatewayError } from "../errors/index.js";
import type { StageOutcome } from "@studio/runtime";
import type { RerunMode } from "@studio/runtime";
import { makeExecutionService, DEFAULT_PIPELINE } from "../runtime/service.js";

/** A single execute call advances at most this many stages before returning. */
const MAX_STAGES_PER_EXECUTE = 20;

/**
 * Why a run ended, when the reason is not visible in the stage list.
 *
 * `truncated` is the one a summary cannot be allowed to omit: if the cap is
 * reached with every stage completing, the loop exits the same way it would
 * after a finished pipeline, and "20 completed, 0 failed, 20 total" reads as
 * a finish. It is not one — more stages may remain.
 *
 * `halted` carries the service's error for a run that could not even select
 * a stage. Without it a pipeline that failed to resolve produced "Nothing to
 * do", which is what a genuinely finished episode produces. That distinction
 * is the one avg-qr4.1's `sawCompletion` bought, and it has to survive here.
 */
interface RunNote {
  truncated?: boolean;
  limit?: number;
  halted?: string;
}

/** The shape the web UI already reads. Kept deliberately unchanged. */
function report(
  ref: { channel: string; series: string; episode: string },
  pipeline: string,
  stages: StageOutcome[],
  startedAt: number,
  note: RunNote = {},
) {
  const totalDurationMs = Date.now() - startedAt;
  const seconds = (totalDurationMs / 1000).toFixed(1);
  const count = (status: StageOutcome["status"]) => stages.filter((s) => s.status === status).length;
  const parts = [`${count("completed")} completed`, `${count("failed")} failed`];
  // A run that halted is not a run that finished.
  if (count("awaiting_review") > 0) parts.push(`${count("awaiting_review")} awaiting review`);
  if (count("blocked") > 0) parts.push(`${count("blocked")} blocked`);
  parts.push(`${stages.length} total`);
  if (note.truncated) {
    parts.push(
      `stopped at this call's limit of ${note.limit ?? MAX_STAGES_PER_EXECUTE} stages — ` +
      `the pipeline may have more`,
    );
  }
  if (note.halted) parts.push(`halted: ${note.halted}`);

  return {
    episodeSlug: `${ref.channel}/${ref.series}/${ref.episode}`,
    pipeline,
    stages: stages.map((s) => ({
      stageId: s.stageId,
      status: s.status,
      outputs: s.outputs,
      durationMs: s.durationMs,
      ...(s.reason ? { error: s.reason } : {}),
    })),
    totalDurationMs,
    summary: stages.length > 0
      ? `${parts.join(", ")} (${seconds}s)`
      : note.halted
        ? `Nothing ran — ${note.halted} (${seconds}s)`
        : `Nothing to do (${seconds}s)`,
  };
}

/**
 * Route params come from find-my-way, which matches an empty path segment
 * (e.g. a request URL containing `//`) as a present-but-empty string — so
 * fastify's `required: [...]` schema check, which only tests for key
 * presence, does not catch it. An empty segment reaching the journal as an
 * episode ref makes `buildJournalEvent` throw after a lease is already held
 * (see journal.mjs), so it is rejected here instead, before any lease is
 * taken.
 */
function parseEpisode(params: Record<string, string>): EpisodeRef {
  const ref = {
    channel: params.channel!,
    series: params.series!,
    episode: params.episode!,
  };
  if (!ref.channel || !ref.series || !ref.episode) {
    throw new GatewayError({
      code: ErrorCode.BAD_REQUEST,
      message: "channel, series and episode must all be non-empty",
    });
  }
  return ref;
}

async function inheritedPipeline(workspace: WorkspaceService, ref: EpisodeRef, explicit?: string): Promise<string | undefined> {
  if (explicit) return explicit;
  const episode = await workspace.getEpisode(ref.channel, ref.series, ref.episode);
  const pipeline = episode?.pipeline;
  return typeof pipeline === "string" && pipeline.length > 0 ? pipeline : undefined;
}

export function registerProductionRoutes(
  app: FastifyInstance,
  runtime: RuntimeClient,
  workspace: WorkspaceService,
  options: {
    /**
     * How much work one /execute call may do. Configurable because it is a
     * deployment choice, and because the truncation branch below is otherwise
     * only reachable by a pipeline with more than twenty runnable stages.
     */
    maxStagesPerExecute?: number;
    /**
     * The library this gateway serves, resolved by the server.
     *
     * Required: every handler below composes an ExecutionService, and an
     * execution service writes the journal. See the comment on
     * `registerRoutes`' parameter of the same name for what a route that
     * guesses its own root does to the journal.
     */
    libraryRoot: string;
    /**
     * The operator's credential (avg-qr4.3): what a human decision on
     * `/approve` or `/reject` is signed with. `null` for a gateway with no
     * key configured, or a test that supplies none — such a caller can
     * still record a request, it just cannot grant or refuse one on a human
     * gate. It is also what the review gate verifies a human receipt with.
     *
     * Required, not optional, for the reason `makeExecutionService` gives: an
     * optional key is an invitation for one caller to keep quietly passing
     * `undefined` while every other one threads the resolved key. The review
     * gate verifies human receipts with it, so the caller that forgot would
     * report every operator approval as unverifiable — awaiting review
     * forever — and nobody would notice until an operator asked why.
     */
    operatorKey: string | null;
  },
): void {
  const maxStagesPerExecute = options.maxStagesPerExecute ?? MAX_STAGES_PER_EXECUTE;

  /**
   * The gateway's composition, pointed at the library the server serves.
   *
   * Seven handlers below need it. Routed through one function for the same
   * reason `makeExecutionService` exists at all: the site that forgets an
   * argument is the one that writes the journal somewhere nobody is looking.
   */
  const serviceFor = (request: { log: { info: (message: string) => void } }) =>
    makeExecutionService((message) => request.log.info(message), options.libraryRoot, options.operatorKey);
  // ── Snapshot ──────────────────────────────────────────────────────────────
  app.post("/api/channels/:channel/series/:series/episodes/:episode/snapshot", {
    schema: {
      description: "Create an immutable pipeline snapshot for an episode.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
        },
      },
      body: {
        type: "object",
        properties: {
          label: { type: "string" },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const pipeline = await inheritedPipeline(workspace, ref);
    const result = await runtime.resolve(ref, pipeline);
    if (!result.ok) {
      throw new GatewayError({
        code: ErrorCode.RUNTIME_UNREACHABLE,
        message: result.error ?? "Snapshot creation failed",
      });
    }
    return { ok: true, snapshot: result.data, message: "Snapshot created" };
  });

  // ── Execute stage ─────────────────────────────────────────────────────────
  app.post("/api/channels/:channel/series/:series/episodes/:episode/stages/:stage/execute", {
    schema: {
      description: "Execute a single pipeline stage.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode", "stage"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
          stage: { type: "string" },
        },
      },
      body: {
        type: "object",
        properties: {
          dryRun: { type: "boolean", default: false },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const stageId = (request.params as Record<string, string>).stage!;
    const { dryRun } = request.body as { dryRun?: boolean };
    const pipeline = await inheritedPipeline(workspace, ref) ?? DEFAULT_PIPELINE;

    const service = serviceFor(request);
    const outcome = await service.run(ref, pipeline, {
      stage: stageId, dryRun: dryRun ?? false, principal: request.principal ?? "agent",
    });

    // `ok` means the service reached a verdict. A `blocked` outcome is
    // `ok: true` with a `blocked` status — the same convention /execute uses,
    // and it is safe here because the outcome is in the body for the caller
    // to read. This route used to shell out to `vpr run`, which printed
    // "Ready to execute: <stage>" and exited 0: the studio's Run Stage button
    // reported success and nothing had happened.
    return outcome.ok
      ? { ok: true, outcome: outcome.value }
      : { ok: false, error: outcome.error };
  });

  // ── Claim a stage for an out-of-process performer ─────────────────────────
  app.post("/api/channels/:channel/series/:series/episodes/:episode/stages/:stage/claim", {
    schema: {
      description:
        "Lease a stage and record that it has started, for a performer that is not this process. " +
        "The caller must close it with the matching complete call, passing back the leaseId this " +
        "returns; an abandoned claim expires on its own.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode", "stage"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
          stage: { type: "string" },
        },
      },
      body: {
        type: "object",
        properties: {
          dryRun: { type: "boolean", default: false },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const stageId = (request.params as Record<string, string>).stage!;
    const { dryRun } = request.body as { dryRun?: boolean };
    const pipeline = await inheritedPipeline(workspace, ref) ?? DEFAULT_PIPELINE;

    const service = serviceFor(request);
    const outcome = await service.claim(ref, pipeline, {
      stage: stageId, dryRun: dryRun ?? false, principal: request.principal ?? "agent",
    });
    return outcome.ok ? { ok: true, outcome: outcome.value } : { ok: false, error: outcome.error };
  });

  // ── Complete a claimed stage ──────────────────────────────────────────────
  app.post("/api/channels/:channel/series/:series/episodes/:episode/stages/:stage/complete", {
    schema: {
      description:
        "Close a claimed stage with the outputs the performer wrote, or report that it failed. " +
        "leaseId is REQUIRED on every call, including a failure report: without it the service " +
        "closes whatever open claim it finds, so a performer whose lease lapsed could close a " +
        "second holder's claim. Pass the one the matching claim returned — a caller over HTTP " +
        "has the claim response in hand and has no excuse to omit it. " +
        "outputs is required too, unless failed is set. " +
        "Both are enforced by the handler rather than by this schema, so the refusal arrives " +
        "as a sentence explaining why; a client generated from this spec must still send them.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode", "stage"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
          stage: { type: "string" },
        },
      },
      body: {
        type: "object",
        properties: {
          outputs: { type: "array", items: { type: "string" } },
          // Required, but by the handler rather than by this schema, so the
          // refusal reads as one sentence about why rather than as a schema
          // violation naming a field the caller has never heard of.
          leaseId: { type: "string" },
          failed: { type: "boolean", default: false },
          error: { type: "string" },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const stageId = (request.params as Record<string, string>).stage!;
    const body = (request.body ?? {}) as {
      outputs?: string[]; leaseId?: string; failed?: boolean; error?: string;
    };
    const pipeline = await inheritedPipeline(workspace, ref) ?? DEFAULT_PIPELINE;

    // The performer names what it wrote; the service does not go looking.
    // A completion with neither outputs nor a failure report is the caller
    // asking the gateway to infer which files count, which is the inference
    // this whole path exists to remove.
    if (!body.failed && (body.outputs ?? []).length === 0) {
      throw new GatewayError({
        code: ErrorCode.VALIDATION,
        message: "outputs is required: name the files the performer wrote, or set failed",
      });
    }

    // Required here, optional in the service. `complete()` without a lease id
    // closes whatever open claim it finds, which is what lets a performer
    // whose lease lapsed close a second holder's claim. The CLI is allowed to
    // omit it because a human cannot recover a lease id — `LeaseState` carries
    // none. An HTTP caller has the claim response in hand, so refusing is what
    // makes the route's own description true.
    //
    // Enforced for a failure report too, not only for outputs: a `failed`
    // completion appends `stage-failed` against the claim it closes, so an
    // omitted lease id fails somebody else's live attempt. Same hazard, and
    // nothing legitimate needs the looser path — a genuinely abandoned claim
    // self-heals when its lease expires.
    if (!body.leaseId) {
      throw new GatewayError({
        code: ErrorCode.VALIDATION,
        message:
          "leaseId is required: pass the one this stage's claim returned. Without it the " +
          "service closes whichever claim is open, which may not be yours",
      });
    }

    const service = serviceFor(request);
    const outcome = await service.complete(ref, pipeline, stageId, {
      ...(body.failed ? { failed: true, error: body.error } : { outputs: body.outputs }),
      leaseId: body.leaseId,
    });
    return outcome.ok ? { ok: true, outcome: outcome.value } : { ok: false, error: outcome.error };
  });

  // ── Execute full pipeline ─────────────────────────────────────────────────
  app.post("/api/channels/:channel/series/:series/episodes/:episode/execute", {
    schema: {
      description: "Execute pending pipeline stages in dependency order, stopping at the first stage that is blocked, fails, or is awaiting review.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
        },
      },
      body: {
        type: "object",
        properties: {
          pipeline: { type: "string" },
          dryRun: { type: "boolean", default: false },
        },
      },
    },
  }, async (request, _reply) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const { pipeline: requestedPipeline, dryRun } = request.body as { pipeline?: string; dryRun?: boolean };
    const pipeline = await inheritedPipeline(workspace, ref, requestedPipeline) ?? DEFAULT_PIPELINE;

    const service = serviceFor(request);

    if (dryRun) {
      const outcome = await service.run(ref, pipeline, { dryRun: true, principal: request.principal ?? "agent" });
      return outcome.ok
        ? { ok: true, dryRun: true, outcome: outcome.value }
        : { ok: false, dryRun: true, error: outcome.error };
    }

    // The loop the gateway used to own is now just a caller's choice: keep
    // going while stages complete, stop at the first one that does not.
    const startedAt = Date.now();
    const stages: StageOutcome[] = [];
    // Tracked, not inferred: a loop that exits by exhausting the cap looks
    // exactly like one that exits because the pipeline is done — same stage
    // count, same statuses — and the summary must not report the first as the
    // second. `i` is read after the loop for that reason alone.
    let i = 0;
    for (; i < maxStagesPerExecute; i++) {
      const outcome = await service.run(ref, pipeline, { principal: request.principal ?? "agent" });
      if (!outcome.ok) {
        return {
          ok: false,
          error: outcome.error,
          report: report(ref, pipeline, stages, startedAt, { halted: outcome.error.message }),
        };
      }
      if (outcome.value.status === "idle") break;
      stages.push(outcome.value);
      if (outcome.value.status !== "completed") break;
    }
    const truncated = i === maxStagesPerExecute;

    return {
      ok: stages.every((s) => s.status !== "failed"),
      report: report(ref, pipeline, stages, startedAt, { truncated, limit: maxStagesPerExecute }),
    };
  });

  // ── Status ────────────────────────────────────────────────────────────────
  app.get("/api/channels/:channel/series/:series/episodes/:episode/status", {
    schema: {
      description: "Show pipeline status, stages, and projections.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const pipeline = await inheritedPipeline(workspace, ref) ?? DEFAULT_PIPELINE;

    const service = serviceFor(request);
    const status = await service.status(ref, pipeline);
    if (!status.ok) return { ok: false, error: status.error };
    // The `data` envelope stays: the studio reads `res.data.stages`
    // (studio/web/src/lib/production-store.svelte.ts). Returning the
    // service's report at the top level would be tidier and would show the
    // studio an empty pipeline. There is no response schema on this route,
    // deliberately — Fastify strips properties a response schema does not
    // declare, and an out-of-date one here would silently delete `state` and
    // `stateReason`, which is what a caller switches on.
    return { ok: true, data: { pipeline: status.value.pipeline, stages: status.value.stages } };
  });

  // ── Staleness ─────────────────────────────────────────────────────────────
  app.get("/api/channels/:channel/series/:series/episodes/:episode/staleness", {
    schema: {
      description: "Check which artifacts are stale.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
        },
      },
    },
  }, async () => {
    // Staleness is derived from the status projection
    // For MVP, return a basic structure
    return {
      stale: [] as string[],
      affected: [] as string[],
      staleCount: 0,
      affectedCount: 0,
    };
  });

  // ── Rerun plan ────────────────────────────────────────────────────────────
  app.post("/api/channels/:channel/series/:series/episodes/:episode/rerun-plan", {
    schema: {
      description: "Plan a targeted rerun: which stages would re-run, and which prior work is preserved.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
        },
      },
      body: {
        type: "object",
        properties: {
          // The four RerunMode members, spelled as the type spells them.
          // This enum used to offer "rerun-affected", which matches no
          // RerunMode and never has — the real fourth is
          // "rerun-affected-downstream". The studio sent the phantom on
          // every staleness rerun, and it reached a CLI that shrugged.
          //
          // "rerun-affected-downstream" is declared here and refused by the
          // service with MODE_UNSUPPORTED: computing it needs staleness
          // propagation (avg-33r), which nothing wires up. Declared-and-
          // refused is the honest pairing; dropping it from the schema would
          // answer "no such mode" to a mode that exists and is planned.
          mode: {
            type: "string",
            enum: ["retry-current", "rerun-selected", "rerun-affected-downstream", "full-rebuild"],
          },
          stageIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const { mode, stageIds } = (request.body ?? {}) as { mode?: RerunMode; stageIds?: string[] };
    const pipeline = await inheritedPipeline(workspace, ref) ?? DEFAULT_PIPELINE;

    const service = serviceFor(request);
    const plan = await service.planRerun(ref, pipeline, mode ?? "retry-current", stageIds ?? []);
    return plan.ok ? { ok: true, plan: plan.value } : { ok: false, error: plan.error };
  });

  // ── Approve stage ─────────────────────────────────────────────────────────
  // Used to shell out to `vpr approve` and hand back the subprocess's own
  // `{ ok, data, error }`. It now goes through `ExecutionService.review` in
  // process (avg-qr4.3) — the same call the CLI makes — and its verdict
  // depends on `request.principal`, which the auth middleware set from
  // which credential authenticated the request: the operator key signs a
  // grant, anything else (including no credential — see the decorated
  // default in server.ts) only requests one.
  app.post("/api/channels/:channel/series/:series/episodes/:episode/stages/:stage/approve", {
    schema: {
      description: "Approve a manual gate for a stage. Signed when the caller holds the operator key; otherwise recorded as a request for an operator to decide.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode", "stage"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
          stage: { type: "string" },
        },
      },
      body: {
        type: "object",
        properties: {
          justification: { type: "string" },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const stageId = (request.params as Record<string, string>).stage!;
    const pipeline = await inheritedPipeline(workspace, ref) ?? DEFAULT_PIPELINE;
    const outcome = await serviceFor(request).review(ref, pipeline, stageId, {
      decision: "approved", principal: request.principal ?? "agent",
    });
    return outcome.ok ? { ok: true, outcome: outcome.value } : { ok: false, error: outcome.error };
  });

  // ── Reject stage ──────────────────────────────────────────────────────────
  // New alongside the approve rewrite: the same `review()` call the CLI's
  // `vpr reject` makes, with `decision: "rejected"`. A rejection without a
  // note is refused before it reaches the service — noise nobody can act on
  // — by `body.required`, so Fastify answers 400 rather than the service
  // having to reject its own refusal.
  app.post("/api/channels/:channel/series/:series/episodes/:episode/stages/:stage/reject", {
    schema: {
      description: "Reject a manual gate for a stage, with a note explaining why.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode", "stage"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
          stage: { type: "string" },
        },
      },
      body: {
        type: "object",
        required: ["note"],
        properties: {
          note: { type: "string", minLength: 1 },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const stageId = (request.params as Record<string, string>).stage!;
    const { note } = request.body as { note: string };
    const pipeline = await inheritedPipeline(workspace, ref) ?? DEFAULT_PIPELINE;
    const outcome = await serviceFor(request).review(ref, pipeline, stageId, {
      decision: "rejected", principal: request.principal ?? "agent", note,
    });
    return outcome.ok ? { ok: true, outcome: outcome.value } : { ok: false, error: outcome.error };
  });

  // ── Journal ───────────────────────────────────────────────────────────────
  app.get("/api/channels/:channel/series/:series/episodes/:episode/journal", {
    schema: {
      description: "Read the episode event journal.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
        },
      },
      querystring: {
        type: "object",
        properties: {
          type: { type: "string" },
          limit: { type: "number", default: 50 },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    // Read from workspace events
    try {
      const events = await workspace.findEvents(ref, request.query as Record<string, unknown>);
      return { events, episodeSlug: `${ref.channel}/${ref.series}/${ref.episode}` };
    } catch {
      return { events: [], episodeSlug: `${ref.channel}/${ref.series}/${ref.episode}` };
    }
  });

  // ── Init workspace ────────────────────────────────────────────────────────
  app.post("/api/channels/:channel/series/:series/episodes/:episode/init", {
    schema: {
      description: "Initialize a new episode workspace.",
      tags: ["production"],
      params: {
        type: "object",
        required: ["channel", "series", "episode"],
        properties: {
          channel: { type: "string" },
          series: { type: "string" },
          episode: { type: "string" },
        },
      },
      body: {
        type: "object",
        properties: {
          pipeline: { type: "string" },
        },
      },
    },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const { pipeline } = request.body as { pipeline?: string };
    const result = await runtime.init(ref, pipeline);
    return { ok: result.ok, data: result.data, error: result.error };
  });
}
