import { afterEach, describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { appendJournalEvent, parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { deriveGateState } from "@studio/contracts/src/gate-review.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../../dist/src/cli.js");

describe("CLI integration", () => {
  function vpr(args: string[]): { stdout: string; stderr: string; status: number } {
    const result = spawnSync("node", [cliPath, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
      status: result.status ?? 1,
    };
  }

  it("prints help with --help", () => {
    const { stderr, status } = vpr(["--help"]);
    // Should succeed
    expect(status).toBe(0);
    expect(stderr).toContain("Usage: vpr");
  });

  it("prints version with --version", () => {
    const { stdout, status } = vpr(["--version"]);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("0.1.0");
  });

  it("prints version with -v", () => {
    const { stdout, status } = vpr(["-v"]);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("0.1.0");
  });

  it("warns on unknown command", () => {
    const { stderr, status } = vpr(["unknown-cmd"]);
    // Not a fatal error yet – just a warning.
    expect(status).toBe(0);
    expect(stderr).toContain("Unknown command");
  });

  it("prints help when invoked with no arguments", () => {
    const { stderr, status } = vpr([]);
    expect(status).toBe(0);
    expect(stderr).toContain("Usage: vpr");
  });
});

// ── approve ─────────────────────────────────────────────────────────────────
//
// `vpr approve` used to write `approval-granted` carrying `{ stageId }` and
// nothing else. `deriveGateState` reads an approval that names no artifacts as
// `invalidated`, and the journal is append-only — so a human approving a stage
// permanently blocked every dependent of it. These tests hold the record to
// the one shape that can be checked later: the produced artifacts, by hash.

describe("vpr approve", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };

  function vpr(args: string[]) {
    const result = spawnSync("node", [cliPath, ...args], { encoding: "utf-8" });
    return {
      stdout: result.stdout?.toString() ?? "",
      status: result.status ?? 1,
      json: () => JSON.parse(result.stdout?.toString() ?? "{}"),
    };
  }

  /** An episode whose journal records `narration` as completed, with one WAV. */
  async function completedEpisode(outputs: string[] = ["artifacts/narration/s1.wav"]) {
    const root = await mkdtemp(path.join(tmpdir(), "vpr-approve-"));
    roots.push(root);
    const dir = path.join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
    for (const relative of outputs) {
      await mkdir(path.dirname(path.join(dir, relative)), { recursive: true });
      await writeFile(path.join(dir, relative), `bytes for ${relative}`);
    }
    await mkdir(path.join(dir, "artifacts"), { recursive: true });
    const common = { episode: REF, actor: "runtime" as const };
    const data = { stageId: "narration", leaseId: "l1", attemptNumber: 1 };
    await appendJournalEvent(dir, {
      type: "stage-leased", ...common,
      data: { ...data, ttlMs: 600_000, expiresAt: new Date(Date.now() + 6e5).toISOString(), holder: "seed" },
    });
    await appendJournalEvent(dir, { type: "stage-started", ...common, data });
    await appendJournalEvent(dir, { type: "stage-completed", ...common, data: { ...data, outputs } });
    return { root, dir };
  }

  async function gateState(dir: string, stageId: string) {
    const events = parseJournal(await readFile(path.join(dir, JOURNAL_RELATIVE_PATH), "utf-8"));
    return deriveGateState(events, stageId, dir);
  }

  it("records the stage's produced artifacts by hash, so the approval holds", async () => {
    const { root, dir } = await completedEpisode();

    const { status, json } = vpr([
      "approve", "childrens/fairy-tales/ep", "narration", "--library", root, "--json",
    ]);

    expect(status).toBe(0);
    expect(json().recorded).toBe(true);
    expect(json().artifacts).toEqual(["artifacts/narration/s1.wav"]);
    expect((await gateState(dir, "narration")).state).toBe("approved");
  });

  it("is invalidated when an approved artifact changes afterwards", async () => {
    // The point of the hash binding: an approval describes bytes, not a name.
    const { root, dir } = await completedEpisode();
    expect(vpr(["approve", "childrens/fairy-tales/ep", "narration", "--library", root, "--json"]).status).toBe(0);
    expect((await gateState(dir, "narration")).state).toBe("approved");

    await writeFile(path.join(dir, "artifacts", "narration", "s1.wav"), "re-rendered, different bytes");

    const after = await gateState(dir, "narration");
    expect(after.state).toBe("invalidated");
    expect(after.reason).toMatch(/changed since it was approved/);
  });

  it("refuses a stage with no recorded completion rather than writing an empty record", async () => {
    // An empty record is worse than no record: it derives as `invalidated`,
    // and the journal cannot be un-appended.
    const { root, dir } = await completedEpisode();

    const { status, json } = vpr([
      "approve", "childrens/fairy-tales/ep", "illustrations", "--library", root, "--json",
    ]);

    expect(status).toBe(2);
    expect(json().error).toMatch(/no completed attempt/);
    expect((await gateState(dir, "illustrations")).state).toBe("none");
  });

  it("refuses when the approved artifact is no longer on disk", async () => {
    const { root, dir } = await completedEpisode();
    await rm(path.join(dir, "artifacts", "narration", "s1.wav"));

    const { status, json } = vpr([
      "approve", "childrens/fairy-tales/ep", "narration", "--library", root, "--json",
    ]);

    expect(status).toBe(2);
    expect(json().error).toMatch(/Nothing was recorded/);
    expect((await gateState(dir, "narration")).state).toBe("none");
  });
});

// ── run / complete ──────────────────────────────────────────────────────────
//
// `vpr run` used to filter the pipeline for a stage whose declared output
// files were missing on disk and print "Ready to execute: <id>". It consulted
// no gate and persisted nothing, so two operators could be told the same
// stage was theirs and a stage declaring `autopilot: false` was offered to
// anyone who asked. It now claims through the ExecutionService: it selects,
// checks every gate, takes a lease and journals. `vpr complete` closes that
// claim with the outputs the performer names.

describe("vpr run / vpr complete", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  /**
   * The built-in manifests, by absolute path.
   *
   * `createDefaultLoader` searches AVG_BUILTIN_PIPELINES and the library root
   * and nothing else — there is no compiled-in default location — so a
   * throwaway library with no `pipelines/` directory cannot resolve
   * `narrated-illustrated-video` unless the spawned CLI is told where the
   * built-ins live. The gateway's own tests point at the same directory.
   */
  const PIPELINES = path.resolve(__dirname, "../../../pipelines/pipelines");

  function vpr(args: string[]) {
    const result = spawnSync("node", [cliPath, ...args], {
      encoding: "utf-8",
      env: { ...process.env, AVG_BUILTIN_PIPELINES: PIPELINES },
    });
    return {
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
      status: result.status ?? 1,
      json: () => JSON.parse(result.stdout?.toString() ?? "{}"),
    };
  }

  async function episodeFixture() {
    const root = await mkdtemp(path.join(tmpdir(), "vpr-cli-"));
    roots.push(root);
    const dir = path.join(root, "childrens", "series", "fairy-tales", "episodes", "ep");
    await mkdir(path.join(dir, "artifacts"), { recursive: true });
    return { root, dir };
  }

  async function readJournal(dir: string) {
    return parseJournal(await readFile(path.join(dir, JOURNAL_RELATIVE_PATH), "utf-8"));
  }

  /**
   * A one-stage pipeline whose only stage declares a human review.
   *
   * The built-in manifests put every `review: human` stage behind
   * dependencies, so reaching `awaiting_review` through them would mean
   * driving four stages to get at one assertion. The loader scans the
   * library root recursively, so a manifest dropped there is selectable by
   * `--pipeline`.
   */
  async function writeReviewedPipeline(root: string) {
    await mkdir(path.join(root, "pipelines"), { recursive: true });
    await writeFile(path.join(root, "pipelines", "reviewed-single.yaml"), [
      "pipeline:",
      "  id: reviewed-single",
      '  version: "1.0.0"',
      '  description: "One stage that completes and then waits for a person."',
      "  stages:",
      "    - id: brief",
      '      name: "Creative Brief"',
      "      type: editorial",
      '      description: "Research and structure the video topic"',
      "      inputs: []",
      "      outputs:",
      "        - contract: brief.md",
      '          version: "1.0.0"',
      "      gates:",
      "        autopilot: true",
      "        review: human",
      "        retry_on_failure: 1",
      "      depends_on: []",
      "",
    ].join("\n"));
  }

  describe("vpr run claims a stage", () => {
    it("leases the stage and journals it, rather than printing advice", async () => {
      const { root, dir } = await episodeFixture();

      const result = vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);

      expect(result.status).toBe(0);
      const out = result.json();
      expect(out.status).toBe("claimed");
      expect(out.stage).toBe("brief");
      expect(out.leaseId).toBeTruthy();
      expect(out.expiresAt).toBeTruthy();

      const events = await readJournal(dir);
      expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
    });

    it("prints the completion command, lease and all, so the safe path is the easy one", async () => {
      // `complete` without `--lease` closes whatever claim is open, which is
      // the SECOND holder's claim once a lapsed claim has been retaken. The
      // lease id is recoverable from nowhere else: `LeaseState` carries
      // state, holder and expiresAt and no id, so `vpr status` cannot show
      // it. Printing the whole command is what keeps the safe form to hand.
      const { root } = await episodeFixture();

      const result = vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);

      const out = result.json();
      expect(out.message).toContain(
        `vpr complete childrens/fairy-tales/ep brief --lease ${out.leaseId} --outputs `,
      );
    });

    it("--dry-run reports the selection and every gate, and writes nothing", async () => {
      const { root, dir } = await episodeFixture();

      const result = vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json", "--dry-run"]);

      expect(result.status).toBe(0);
      expect(result.json().status).toBe("would-run");
      await expect(readJournal(dir)).rejects.toThrow();
    });

    it("refuses a stage the manifest says may not run unattended", async () => {
      // `script` declares `autopilot: false`. Its dependency has to be
      // satisfied first, or the refusal reported is the dependency's and the
      // autopilot gate is never reached.
      const { root, dir } = await episodeFixture();
      vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);
      await writeFile(path.join(dir, "artifacts/brief.md"), "a real brief");
      vpr([
        "complete", "childrens/fairy-tales/ep", "brief",
        "--outputs", "artifacts/brief.md", "--library", root, "--json",
      ]);

      const result = vpr([
        "run", "childrens/fairy-tales/ep", "--stage", "script", "--library", root, "--json",
      ]);

      // The service worked and refused. That is not a CLI failure.
      expect(result.status).toBe(0);
      const out = result.json();
      expect(out.status).toBe("blocked");
      expect(out.reason).toMatch(/autopilot/);
    });

    it("reports an unresolvable pipeline as a runtime failure", async () => {
      const { root } = await episodeFixture();

      const result = vpr([
        "run", "childrens/fairy-tales/ep", "--pipeline", "no-such-pipeline", "--library", root, "--json",
      ]);

      expect(result.status).toBe(2);
      expect(result.json().error).toMatch(/PIPELINE_UNRESOLVED/);
    });
  });

  describe("vpr complete closes a claim", () => {
    it("records the outputs the performer names", async () => {
      const { root, dir } = await episodeFixture();
      vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);
      await writeFile(path.join(dir, "artifacts/brief.md"), "a real brief");

      const result = vpr([
        "complete", "childrens/fairy-tales/ep", "brief",
        "--outputs", "artifacts/brief.md", "--library", root, "--json",
      ]);

      expect(result.status).toBe(0);
      expect(result.json().status).toBe("completed");
      const events = await readJournal(dir);
      expect(events.map((e) => e.type)).toEqual(["stage-leased", "stage-started", "stage-completed"]);
    });

    it("accepts the lease id the run command printed", async () => {
      const { root, dir } = await episodeFixture();
      const leaseId = vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]).json().leaseId;
      await writeFile(path.join(dir, "artifacts/brief.md"), "a real brief");

      const result = vpr([
        "complete", "childrens/fairy-tales/ep", "brief", "--lease", leaseId,
        "--outputs", "artifacts/brief.md", "--library", root, "--json",
      ]);

      expect(result.status).toBe(0);
      expect(result.json().status).toBe("completed");
    });

    it("refuses a successful completion that names no outputs", async () => {
      const { root } = await episodeFixture();
      vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);

      const result = vpr([
        "complete", "childrens/fairy-tales/ep", "brief", "--library", root, "--json",
      ]);

      expect(result.status).toBe(1);
      expect(result.json().error).toMatch(/--outputs/);
    });

    it("records a reported failure", async () => {
      const { root, dir } = await episodeFixture();
      vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);

      const result = vpr([
        "complete", "childrens/fairy-tales/ep", "brief",
        "--failed", "--error", "the model refused", "--library", root, "--json",
      ]);

      expect(result.status).toBe(0);
      expect(result.json().status).toBe("failed");
      const events = await readJournal(dir);
      expect(events.some((e) => e.type === "stage-failed")).toBe(true);
    });

    it("reports a stage awaiting review as the success it is", async () => {
      // `awaiting_review` is what a stage declaring `review: human` reports
      // once it completes: the work is done and recorded (`stage-completed`),
      // and acceptance is someone else's turn. Exiting non-zero on it would
      // tell every script that a successful stage had failed.
      const { root, dir } = await episodeFixture();
      await writeReviewedPipeline(root);
      const claimed = vpr([
        "run", "childrens/fairy-tales/ep", "--pipeline", "reviewed-single", "--library", root, "--json",
      ]);
      expect(claimed.json().status).toBe("claimed");
      await writeFile(path.join(dir, "artifacts/brief.md"), "a real brief");

      const result = vpr([
        "complete", "childrens/fairy-tales/ep", "brief", "--pipeline", "reviewed-single",
        "--outputs", "artifacts/brief.md", "--library", root, "--json",
      ]);

      expect(result.status).toBe(0);
      expect(result.json().status).toBe("awaiting_review");
      const events = await readJournal(dir);
      expect(events.some((e) => e.type === "stage-completed")).toBe(true);
    });

    it("reports an unknown stage as a runtime failure", async () => {
      const { root } = await episodeFixture();

      const result = vpr([
        "complete", "childrens/fairy-tales/ep", "no-such-stage",
        "--outputs", "artifacts/x.md", "--library", root, "--json",
      ]);

      expect(result.status).toBe(2);
      expect(result.json().error).toMatch(/STAGE_UNKNOWN/);
    });

    it("--dry-run writes nothing", async () => {
      const { root, dir } = await episodeFixture();
      vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);
      const before = (await readJournal(dir)).length;

      const result = vpr([
        "complete", "childrens/fairy-tales/ep", "brief",
        "--outputs", "artifacts/brief.md", "--library", root, "--json", "--dry-run",
      ]);

      expect(result.status).toBe(0);
      expect(result.json().dryRun).toBe(true);
      expect((await readJournal(dir)).length).toBe(before);
    });

    it("keeps positionals that follow a flag taking no value", async () => {
      // `--failed` consumes nothing, so a token after it is still a
      // positional. Dropping it would report a usage error for a command
      // that named its episode and stage perfectly well.
      const { root } = await episodeFixture();
      vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);

      const result = vpr([
        "complete", "--failed", "childrens/fairy-tales/ep", "brief",
        "--error", "the model refused", "--library", root, "--json",
      ]);

      expect(result.status).toBe(0);
      expect(result.json().status).toBe("failed");
    });
  });
});
