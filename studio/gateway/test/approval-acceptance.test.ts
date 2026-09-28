// ---------------------------------------------------------------------------
// The acceptance line (avg-qr4.3)
// ---------------------------------------------------------------------------
// Every other gateway test drives `registerProductionRoutes` on a bare
// Fastify instance and sets `request.principal` from an `x-test-principal`
// header (see `review-routes.test.ts`) or injects it directly (see
// `gate-enforcement.test.ts`'s `gatewayService`). That is the right tool for
// testing the execution service and the routes' own logic, but neither one
// touches the thing avg-qr4.3 actually changed: `createGateway`'s real
// `preHandler` hook, which resolves a Bearer header to a principal by
// comparing it against the gateway token and the operator key.
//
// This file is the one exception, and deliberately the only one: the full
// composition, authenticated with real headers, so a wiring mistake in
// `server.ts` — the operator key resolved from the wrong file, the auth hook
// never reaching the production routes, the two credentials colliding — has
// somewhere to fail loudly instead of only in production.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/index.js";
import { resolveToken, resolveOperatorKey } from "../src/auth/index.js";
import { createGateway, type GatewayInstance } from "../src/server.js";
import type { WorkspaceService } from "../src/workspace/service.js";
import { appendJournalEvent } from "@studio/contracts/src/journal.mjs";
import { buildGateReview, hashArtifacts } from "@studio/contracts/src/gate-review.mjs";

const REF = { channel: "childrens", series: "fairy-tales", episode: "the-acceptance-line" };
/** The slug a human receipt signs (avg-qr4.3 final review). */
const EPISODE = `${REF.channel}/${REF.series}/${REF.episode}`;
const BASE = `/api/channels/${REF.channel}/series/${REF.series}/episodes/${REF.episode}`;

const roots: string[] = [];
let gateway: GatewayInstance | undefined;

afterEach(async () => {
  await gateway?.stop();
  gateway = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

describe("the approval acceptance line", () => {
  it("script → operator approves → compose may run; the same approval with Pi's token stops at requested", async () => {
    // Ruling 2: token.file and operatorKey.file point into a temp dir this
    // test owns, and AVG_OPERATOR_KEY_FILE is unset — this composition can
    // never read or write studio/gateway/.gateway-token or
    // studio/gateway/.operator-key, the files a real running gateway holds.
    vi.stubEnv("AVG_OPERATOR_KEY_FILE", "");

    const configDir = await mkdtemp(join(tmpdir(), "gw-accept-config-"));
    const libraryRoot = await mkdtemp(join(tmpdir(), "gw-accept-library-"));
    roots.push(configDir, libraryRoot);

    // `createGateway` resolves its library as
    // `process.env.AVG_LIBRARY_ROOT ?? config.libraryRoots[0] ?? "./library"`
    // (server.ts) — env wins over config, by design, unlike the routes other
    // gateway tests drive directly with an explicit `libraryRoot` argument.
    // A decoy value here (the pattern `single-stage-route.test.ts` uses to
    // prove a route does NOT fall back to the environment) would therefore
    // make this composition's real library the decoy, not the temp dir this
    // test writes into and asserts against. Stubbed to the SAME value as
    // `config.libraryRoots[0]` instead: if the repository's own root `.env`
    // has `AVG_LIBRARY_ROOT` set to the real production library (it does),
    // this is what stops the claim/complete calls below from leasing and
    // journaling into it.
    vi.stubEnv("AVG_LIBRARY_ROOT", libraryRoot);

    const config = loadConfig();
    config.port = 0;
    config.host = "127.0.0.1";
    config.token.file = join(configDir, "gateway-token");
    config.operatorKey.file = join(configDir, "operator-key");
    config.libraryRoots = [libraryRoot];

    const agentToken = resolveToken(config.token);
    // Generated here, not left to `createGateway`, so this test has the raw
    // key in hand to sign its own Bearer header with. `createGateway` below
    // resolves the same env-or-config path and finds the file already
    // written, exactly as a real operator's second process would.
    const operatorKey = resolveOperatorKey(config.operatorKey.file);
    expect(agentToken).not.toBe(operatorKey);

    // A stub, not `FileSystemWorkspaceService`: every route this test drives
    // only asks the workspace for an episode's declared pipeline, to fall
    // back to `DEFAULT_PIPELINE` when there is none (see
    // `production.ts`'s `inheritedPipeline`). A stub keeps the fixture this
    // test owns — the auth wiring — separate from the filesystem workspace
    // service's own behaviour, which other tests already cover.
    const workspace = { getEpisode: async () => null } as unknown as WorkspaceService;

    gateway = await createGateway(config, agentToken, workspace);
    const app = gateway.app;

    const dir = join(libraryRoot, REF.channel, "series", REF.series, "episodes", REF.episode);
    await mkdir(join(dir, "artifacts"), { recursive: true });

    async function post(path: string, bearer: string, body: Record<string, unknown> = {}) {
      const res = await app.inject({
        method: "POST",
        url: `${BASE}${path}`,
        headers: { authorization: `Bearer ${bearer}` },
        payload: body,
      });
      return res.json();
    }

    // 1. `script`'s one dependency (`brief`) and `script` itself, over the
    // real claim/complete routes, as the operator: neither stage has a
    // gateway dispatcher handler (see `GatewayDispatcher`), and `script`
    // declares `autopilot: false`, so only the operator may take it at all
    // (narrated-illustrated-video.yaml).
    const briefClaim = await post("/stages/brief/claim", operatorKey);
    expect(briefClaim.outcome.status).toBe("claimed");
    await writeFile(join(dir, "artifacts", "brief.md"), "# Brief\n");
    const briefComplete = await post("/stages/brief/complete", operatorKey, {
      outputs: ["artifacts/brief.md"], leaseId: briefClaim.outcome.leaseId,
    });
    expect(briefComplete.outcome.status).toBe("completed");

    const scriptClaim = await post("/stages/script/claim", operatorKey);
    expect(scriptClaim.outcome.status).toBe("claimed");
    await writeFile(join(dir, "artifacts", "script.md"), "# A script someone has to accept\n");
    const scriptComplete = await post("/stages/script/complete", operatorKey, {
      outputs: ["artifacts/script.md"], leaseId: scriptClaim.outcome.leaseId,
    });
    // `script` declares `review: human`: completing it is not accepting it.
    expect(scriptComplete.outcome.status).toBe("awaiting_review");

    // 2. Pi's own credential — the gateway token, never the operator key —
    // approving a `review: human` stage. The auth hook resolves it to the
    // `agent` principal, and `ExecutionService.review` downgrades an agent's
    // decision on a human gate to a request rather than a grant.
    const requested = await post("/stages/script/approve", agentToken);
    expect(requested.outcome.status).toBe("requested");

    // 3. `art-direction` is the first stage narrated-illustrated-video.yaml
    // declares depending on `script`. It has no gateway handler either, but
    // that is not the refusal reached here: with only a request on file,
    // `script`'s review is still outstanding.
    const blockedBefore = await post("/stages/art-direction/execute", agentToken);
    expect(blockedBefore.outcome.status).toBe("blocked");
    expect(blockedBefore.outcome.reason).toMatch(/"script"/);
    expect(blockedBefore.outcome.reason).toMatch(/review/);

    // 4. The operator's Bearer header authenticates as `operator`, so this
    // decision is signed and actually granted.
    const approved = await post("/stages/script/approve", operatorKey);
    expect(approved.outcome.status).toBe("approved");

    // 5. `art-direction` is no longer blocked by `script`'s review — only by
    // having no dispatcher handler, which is a fact about `art-direction`,
    // not about `script`.
    const blockedAfter = await post("/stages/art-direction/execute", agentToken);
    expect(blockedAfter.outcome.status).toBe("blocked");
    expect(blockedAfter.outcome.reason).not.toMatch(/script/);

    // 6. A forged `approval-granted` — human origin, no signature — appended
    // straight to the journal, the way any process running as the
    // operator's own user could with nothing but file tools. It must not
    // read as accepted: `deriveGateState` requires a signature on a human
    // decision, and this one, appended after the real signed approval
    // above, has none.
    const outputs = await hashArtifacts(dir, ["artifacts/script.md"]);
    await appendJournalEvent(dir, {
      type: "approval-granted", actor: "runtime", episode: REF,
      data: buildGateReview({
        stageId: "script", decision: "approved", origin: "human", actor: "runtime", episode: EPISODE,
        binding: { planHash: "0".repeat(64), outputs },
      }),
    });

    const status = await app.inject({
      method: "GET", url: `${BASE}/status`,
      headers: { authorization: `Bearer ${operatorKey}` },
    });
    const scriptStatus = status.json().data.stages.find((s: { stageId: string }) => s.stageId === "script");
    expect(scriptStatus.state).toBe("awaiting_review");
    expect(scriptStatus.stateReason).toMatch(/unsigned/);
  });
});
