import { afterEach, describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { appendJournalEvent, parseJournal, JOURNAL_RELATIVE_PATH } from "@studio/contracts/src/journal.mjs";
import { deriveGateState } from "@studio/contracts/src/gate-review.mjs";
import { verifyReceipt } from "@studio/contracts/src/receipt.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/**
 * The compiled CLI, not the source.
 *
 * Every test in this file spawns this file, so it only ever exercises
 * whatever was last built into `dist/` — never a live read of `src/cli.ts`.
 * Run this suite via `npm test -w @studio/runtime`, whose `pretest` rebuilds
 * first; a bare `vitest run test/integration/cli.test.ts` (with or without
 * `--root studio/runtime`) skips that build and silently tests stale code.
 * That gap is not hypothetical: re-adding a field this suite asserts is
 * absent, then running vitest directly without rebuilding, passes every test.
 */
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

// ── approve / reject ────────────────────────────────────────────────────────
//
// `vpr approve` used to write `approval-granted` carrying `{ stageId }` and
// nothing else, hashed no artifacts and signed nothing. It now decides
// through `ExecutionService.review` (avg-qr4.3): the record binds the
// stage's produced artifacts by hash, and an operator's decision is signed
// with a key only the operator (and the gateway that minted it) can read. A
// caller that cannot read the key is an agent, not an error — asking a
// `review: human` stage to approve downgrades to a request instead of
// assuming yes.

describe("vpr approve / vpr reject", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  const REF = { channel: "childrens", series: "fairy-tales", episode: "ep" };
  const KEY = "operator-key-for-tests";

  function vpr(args: string[], env: Record<string, string> = {}) {
    const result = spawnSync("node", [cliPath, ...args], {
      encoding: "utf-8",
      env: { ...process.env, ...env },
    });
    return {
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
      status: result.status ?? 1,
      json: () => JSON.parse(result.stdout?.toString() ?? "{}"),
    };
  }

  /**
   * A library whose pipeline puts `narration` under human review.
   *
   * The built-in `narrated-illustrated-video` manifest declares `narration`
   * `review: none` — that stage IS the mastered narration, not a checkpoint
   * on it. These tests need a stage a human decision actually applies to, so
   * this shadows the built-in under the same pipeline id at the library
   * root, which `createDefaultLoader` scans without needing
   * `AVG_BUILTIN_PIPELINES` at all.
   */
  async function writeReviewedNarrationPipeline(root: string) {
    await mkdir(path.join(root, "pipelines"), { recursive: true });
    await writeFile(path.join(root, "pipelines", "narrated-illustrated-video.yaml"), [
      "pipeline:",
      "  id: narrated-illustrated-video",
      '  version: "1.0.0"',
      '  description: "Test fixture: narration under human review (avg-qr4.3)."',
      "  stages:",
      "    - id: narration",
      '      name: "Narration"',
      "      type: editorial",
      '      description: "Generate narration audio"',
      "      inputs: []",
      "      outputs:",
      "        - contract: narration.wav",
      '          version: "1.0.0"',
      "      gates:",
      "        autopilot: true",
      "        review: human",
      "        retry_on_failure: 1",
      "      depends_on: []",
      "",
    ].join("\n"));
  }

  /** An episode whose journal records `narration` as completed, with one WAV. */
  async function completedEpisode(outputs: string[] = ["artifacts/narration/s1.wav"]) {
    const root = await mkdtemp(path.join(tmpdir(), "vpr-approve-"));
    roots.push(root);
    await writeReviewedNarrationPipeline(root);
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

  /**
   * The gate state as a reader holding the operator key sees it. Without the
   * key a human decision is `unverifiable` (avg-qr4.3), which is right for a
   * reader that cannot check it and useless for asserting what was written.
   */
  async function gateState(dir: string, stageId: string) {
    const events = parseJournal(await readFile(path.join(dir, JOURNAL_RELATIVE_PATH), "utf-8"));
    return deriveGateState(events, stageId, dir, { key: KEY });
  }

  async function events(dir: string) {
    return parseJournal(await readFile(path.join(dir, JOURNAL_RELATIVE_PATH), "utf-8"));
  }

  /** A 0600 operator key file under this episode's own root, for the CLI to read. */
  async function operatorKeyFile(root: string): Promise<string> {
    const file = path.join(root, ".operator-key");
    await writeFile(file, KEY, { mode: 0o600 });
    return file;
  }

  it("with the operator key, records a signed human approval", async () => {
    const { root, dir } = await completedEpisode();
    const keyFile = await operatorKeyFile(root);

    const r = vpr(
      ["approve", "childrens/fairy-tales/ep", "narration", "--library", root, "--json"],
      { AVG_OPERATOR_KEY_FILE: keyFile },
    );

    expect(r.status).toBe(0);
    const grant = (await events(dir)).filter((e) => e.type === "approval-granted").at(-1)!;
    expect(verifyReceipt(grant.data as object, KEY)).toBe(true);
    expect((await gateState(dir, "narration")).state).toBe("approved");
  });

  it("is invalidated when an approved artifact changes afterwards", async () => {
    // The point of the hash binding: an approval describes bytes, not a name.
    const { root, dir } = await completedEpisode();
    const keyFile = await operatorKeyFile(root);
    const env = { AVG_OPERATOR_KEY_FILE: keyFile };
    expect(vpr(["approve", "childrens/fairy-tales/ep", "narration", "--library", root, "--json"], env).status).toBe(0);
    expect((await gateState(dir, "narration")).state).toBe("approved");

    await writeFile(path.join(dir, "artifacts", "narration", "s1.wav"), "re-rendered, different bytes");

    const after = await gateState(dir, "narration");
    expect(after.state).toBe("invalidated");
    expect(after.reason).toMatch(/changed since it was approved/);
  });

  it("vpr status reads the operator's own approval as completed, because it holds the key too", async () => {
    // Every CLI command resolves the operator key, not only approve/reject:
    // `status` consults the review gate, and a gate composed with no key
    // reads every human decision as unverifiable — so the operator who just
    // approved a stage would be told it is still awaiting review.
    const { root } = await completedEpisode();
    const env = { AVG_OPERATOR_KEY_FILE: await operatorKeyFile(root) };
    expect(vpr(["approve", "childrens/fairy-tales/ep", "narration", "--library", root, "--json"], env).status).toBe(0);

    const withKey = vpr(["status", "childrens/fairy-tales/ep", "--library", root, "--json"], env);
    expect(withKey.status).toBe(0);
    const narration = (withKey.json().stages as { stageId: string; state: string }[])
      .find((s) => s.stageId === "narration")!;
    expect(narration.state).toBe("completed");

    const withoutKey = vpr(
      ["status", "childrens/fairy-tales/ep", "--library", root, "--json"],
      { AVG_OPERATOR_KEY_FILE: path.join(root, "absent") },
    );
    const unverified = (withoutKey.json().stages as { stageId: string; state: string; stateReason?: string }[])
      .find((s) => s.stageId === "narration")!;
    expect(unverified.state).toBe("awaiting_review");
    expect(unverified.stateReason).toMatch(/cannot be verified/);
  });

  it("vpr status refuses a group-readable operator key rather than treating it as absent", async () => {
    const { root } = await completedEpisode();
    const file = path.join(root, ".loose-key");
    await writeFile(file, KEY, { mode: 0o644 });
    const r = vpr(["status", "childrens/fairy-tales/ep", "--library", root, "--json"], { AVG_OPERATOR_KEY_FILE: file });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/0600/);
  });

  it("without the key, exits non-zero and leaves a request for an operator", async () => {
    const { root, dir } = await completedEpisode();

    const r = vpr(
      ["approve", "childrens/fairy-tales/ep", "narration", "--library", root, "--json"],
      { AVG_OPERATOR_KEY_FILE: path.join(root, "absent") },
    );

    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/approval requested/);
    expect((await events(dir)).at(-1)!.type).toBe("approval-requested");
  });

  it("vpr reject records a signed rejection with its note", async () => {
    const { root, dir } = await completedEpisode();
    const keyFile = await operatorKeyFile(root);

    const r = vpr(
      ["reject", "childrens/fairy-tales/ep", "narration", "--note", "too quiet", "--library", root, "--json"],
      { AVG_OPERATOR_KEY_FILE: keyFile },
    );

    expect(r.status).toBe(0);
    const rej = (await events(dir)).at(-1)!;
    expect(rej.type).toBe("approval-rejected");
    expect(verifyReceipt(rej.data as object, KEY)).toBe(true);
    expect((rej.data as { note?: string }).note).toBe("too quiet");
  });

  it("vpr reject without --note is a usage error and writes nothing", async () => {
    const { root, dir } = await completedEpisode();
    const keyFile = await operatorKeyFile(root);
    const before = await events(dir);

    const r = vpr(
      ["reject", "childrens/fairy-tales/ep", "narration", "--library", root, "--json"],
      { AVG_OPERATOR_KEY_FILE: keyFile },
    );

    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/--note/);
    expect(await events(dir)).toEqual(before);
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

  function vpr(args: string[], env: Record<string, string> = {}) {
    const result = spawnSync("node", [cliPath, ...args], {
      encoding: "utf-8",
      // An absent key file unless a test says otherwise: every command now
      // resolves the operator key (avg-qr4.3), and the default location is
      // the developer's real one.
      env: { ...process.env, AVG_BUILTIN_PIPELINES: PIPELINES,
             AVG_OPERATOR_KEY_FILE: path.join(tmpdir(), "vpr-cli-no-operator-key"), ...env },
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

    // Fix round 1 on task-2 (contracts): `parsePath` counted segments
    // (`parts.length === 3`) but never checked they were non-empty, so
    // "video-storici//giulio-cesare" parsed to a `series` of "". That ref
    // reached `appendJournalEvent`, which now throws rather than returning
    // null for a malformed event — and the throw hit after the lease for
    // "brief" was already taken, leaking a lockfile with no journal event to
    // explain it. The fix is at the boundary: an empty segment is rejected
    // here, the same way a wrong segment count always was, before any lease
    // is taken.
    it("refuses a path with an empty segment as a usage error, taking no lease", async () => {
      const { root, dir } = await episodeFixture();

      const result = vpr(["run", "childrens//ep", "--library", root, "--json"]);

      expect(result.status).toBe(1);
      const out = result.json();
      expect(out.error).toMatch(/Invalid path/);

      // No lockfile left behind, and no journal — nothing was ever leased.
      const locks = await readdir(path.join(dir, ".locks")).catch(() => []);
      expect(locks).toEqual([]);
      await expect(readFile(path.join(dir, JOURNAL_RELATIVE_PATH), "utf-8")).rejects.toThrow();
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
        `vpr complete childrens/fairy-tales/ep brief --library ${root} ` +
        `--lease ${out.leaseId} --outputs PATH`,
      );
    });

    it("prints a command that actually works when pasted", async () => {
      // The strongest form of the assertion above: run the line. A printed
      // command missing --library resolves against the caller's cwd, finds no
      // journal, and reports `"brief" has no open claim to complete` at exit
      // 0 — the performer told its claim does not exist at the moment it
      // does. `--outputs <path>` fails differently and just as hard: `<` is a
      // shell redirect, so the line is a syntax error before it runs.
      const { root, dir } = await episodeFixture();
      const claimed = vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);
      await writeFile(path.join(dir, "artifacts/brief.md"), "a real brief");

      const line = String(claimed.json().message).split("\n")[1]!.trim();
      expect(line).not.toMatch(/[<>]/);
      const pasted = line.replace(/^vpr /, "").replace("PATH", "artifacts/brief.md");
      const result = vpr([...pasted.split(" "), "--json"]);

      expect(result.status).toBe(0);
      expect(result.json().status).toBe("completed");
    });

    it("reads the episode from the positionals, not the first non-flag token", async () => {
      // `remaining.find((a) => !a.startsWith("--"))` took `--library`'s VALUE
      // as the episode. While run only printed advice that was harmless
      // nonsense; now it leases and journals, so it wrote stage-leased and
      // stage-started into a library nobody named.
      const { root, dir } = await episodeFixture();

      const result = vpr(["run", "--library", root, "childrens/fairy-tales/ep", "--json"]);

      expect(result.status).toBe(0);
      expect(result.json().stage).toBe("brief");
      // Journaled where it was asked to, and nowhere else.
      expect((await readJournal(dir)).length).toBe(2);
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

    it("passes --stage through to the service", async () => {
      // A `claim()` that never receives `stage` leaves every other test in
      // this file green: after `brief` completes, unnamed selection picks
      // `script` anyway. Naming a stage no pipeline declares is the one
      // request whose answer can only come from the flag being forwarded.
      const { root } = await episodeFixture();

      const result = vpr([
        "run", "childrens/fairy-tales/ep", "--stage", "no-such-stage", "--library", root, "--json",
      ]);

      expect(result.json().error).toMatch(/STAGE_UNKNOWN/);
      // A mistyped argument is a usage error, distinguishable by a script
      // from an unreadable journal.
      expect(result.status).toBe(1);
    });

    it("refuses a mistyped AVG_CLAIM_TTL_MS instead of claiming with it", async () => {
      // `Number(env ?? default)` catches only `undefined`, so `0` and `abc`
      // reached the service as a deliberate TTL. `0` is the bad one: the CLI
      // claimed, journaled both events, and left a stage whose every later
      // completion reports the lease lapsed — burned, with no error printed
      // anywhere. `abc` gave NaN and surfaced as `cannot start from its
      // current state ("pending")`, naming the wrong cause entirely.
      const { root, dir } = await episodeFixture();

      for (const bad of ["abc", "0", "-1"]) {
        const result = vpr(
          ["run", "childrens/fairy-tales/ep", "--library", root, "--json"],
          { AVG_CLAIM_TTL_MS: bad },
        );
        expect(result.status, `AVG_CLAIM_TTL_MS=${JSON.stringify(bad)}`).toBe(1);
        expect(result.json().error).toMatch(/AVG_CLAIM_TTL_MS/);
      }
      // Refused before anything was leased.
      await expect(readJournal(dir)).rejects.toThrow();
    });

    it("refuses a claim TTL whose scale is wrong, not merely its sign", async () => {
      // `> 0` tests the wrong property. Every realistic mistake here is a
      // unit confusion — `15` meaning fifteen minutes, `900` meaning nine
      // hundred seconds, `1e3` meaning something other than a thousand
      // milliseconds — and each is positive, finite, and burns the stage
      // exactly the way 0 did: claimed, both events journaled, and every
      // later `complete` reporting a lapsed lease with nothing naming why.
      const { root, dir } = await episodeFixture();

      for (const tooShort of ["1e3", "15", "900", "9999"]) {
        const result = vpr(
          ["run", "childrens/fairy-tales/ep", "--library", root, "--json"],
          { AVG_CLAIM_TTL_MS: tooShort },
        );
        expect(result.status, `AVG_CLAIM_TTL_MS=${tooShort}`).toBe(1);
        // The message teaches the units, not just that the number was
        // rejected: an operator who meant fifteen minutes wrote `15`.
        expect(result.json().error).toMatch(/milliseconds/);
        expect(result.json().error).toMatch(/10000/);
      }
      await expect(readJournal(dir)).rejects.toThrow();
    });

    it("accepts a claim TTL at the ten-second floor", async () => {
      const { root } = await episodeFixture();

      const result = vpr(
        ["run", "childrens/fairy-tales/ep", "--library", root, "--json"],
        { AVG_CLAIM_TTL_MS: "10000" },
      );

      expect(result.status).toBe(0);
      expect(result.json().status).toBe("claimed");
      const remaining = Date.parse(result.json().expiresAt) - Date.now();
      expect(remaining).toBeGreaterThan(5_000);
      expect(remaining).toBeLessThanOrEqual(10_000);
    });

    it("treats an empty AVG_CLAIM_TTL_MS as unset and takes the default", async () => {
      // "not set" against "set wrong". `export AVG_CLAIM_TTL_MS=` and
      // `AVG_CLAIM_TTL_MS=${AVG_CLAIM_TTL_MS:-}` are ordinary shell ways of
      // NOT setting a variable, so refusing on empty would hard-fail a CI
      // over a value it never meant to supply — and `builtinPipelines` one
      // line away already reads empty as unset. Two adjacent environment
      // variables must not disagree about what empty means.
      const { root, dir } = await episodeFixture();

      const result = vpr(
        ["run", "childrens/fairy-tales/ep", "--library", root, "--json"],
        { AVG_CLAIM_TTL_MS: "" },
      );

      expect(result.status).toBe(0);
      expect(result.json().status).toBe("claimed");
      // The 15-minute default, not `Number("")` — which is 0, and would have
      // leased a claim that was already dead.
      const remaining = Date.parse(result.json().expiresAt) - Date.now();
      expect(remaining).toBeGreaterThan(14 * 60_000);
      expect(remaining).toBeLessThanOrEqual(15 * 60_000);
      expect((await readJournal(dir)).map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
    });

    it("honours a valid AVG_CLAIM_TTL_MS", async () => {
      const { root } = await episodeFixture();

      const result = vpr(
        ["run", "childrens/fairy-tales/ep", "--library", root, "--json"],
        { AVG_CLAIM_TTL_MS: "60000" },
      );

      const expiresAt = Date.parse(result.json().expiresAt);
      expect(expiresAt - Date.now()).toBeGreaterThan(30_000);
      expect(expiresAt - Date.now()).toBeLessThan(120_000);
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

    it("reports an unknown stage as a usage error", async () => {
      const { root } = await episodeFixture();

      const result = vpr([
        "complete", "childrens/fairy-tales/ep", "no-such-stage",
        "--outputs", "artifacts/x.md", "--library", root, "--json",
      ]);

      expect(result.status).toBe(1);
      expect(result.json().error).toMatch(/STAGE_UNKNOWN/);
    });

    it("refuses a --lease that names an attempt other than the open one", async () => {
      // The whole reason `run` prints the lease id. Without the forward,
      // `complete` closes whichever claim is open — the second holder's,
      // once a lapsed claim has been retaken — and a test that passes the
      // CORRECT lease cannot tell the difference.
      const { root, dir } = await episodeFixture();
      const leaseId = vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]).json().leaseId;
      await writeFile(path.join(dir, "artifacts/brief.md"), "a real brief");

      const result = vpr([
        "complete", "childrens/fairy-tales/ep", "brief", "--lease", "bogus-id",
        "--outputs", "artifacts/brief.md", "--library", root, "--json",
      ]);

      expect(result.json().status).toBe("blocked");
      expect(result.json().reason).toContain("bogus-id");
      expect(result.json().reason).toContain(leaseId);
      // Refused, not recorded: the open claim is still open.
      expect((await readJournal(dir)).map((e) => e.type)).toEqual(["stage-leased", "stage-started"]);
    });

    it("--dry-run writes nothing and predicts what a real call would report", async () => {
      const { root, dir } = await episodeFixture();
      vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);
      const before = (await readJournal(dir)).length;

      const result = vpr([
        "complete", "childrens/fairy-tales/ep", "brief",
        "--outputs", "artifacts/brief.md", "--library", root, "--json", "--dry-run",
      ]);

      expect(result.status).toBe(0);
      expect(result.json().dryRun).toBe(true);
      expect(result.json().status).toBe("completed");
      expect((await readJournal(dir)).length).toBe(before);
    });

    it("--dry-run refuses a stage no pipeline declares, as the real call does", async () => {
      // Echoing the arguments back reported `[DRY RUN] Would complete
      // "totally-made-up"` at exit 0, for a stage nothing declares and nobody
      // has claimed. A dry run answers the same question the real call does
      // or it is worse than no dry run at all.
      const { root } = await episodeFixture();

      const result = vpr([
        "complete", "childrens/fairy-tales/ep", "totally-made-up",
        "--outputs", "artifacts/x.md", "--library", root, "--json", "--dry-run",
      ]);

      expect(result.status).toBe(1);
      expect(result.json().error).toMatch(/STAGE_UNKNOWN/);
    });

    it("--dry-run reports the missing claim a real call would refuse on", async () => {
      const { root } = await episodeFixture();

      const result = vpr([
        "complete", "childrens/fairy-tales/ep", "brief",
        "--outputs", "artifacts/brief.md", "--library", root, "--json", "--dry-run",
      ]);

      expect(result.status).toBe(0);
      expect(result.json().status).toBe("blocked");
      expect(result.json().reason).toMatch(/no open claim/);
    });

    it("--dry-run predicts awaiting_review for a stage that declares one", async () => {
      const { root } = await episodeFixture();
      await writeReviewedPipeline(root);
      vpr(["run", "childrens/fairy-tales/ep", "--pipeline", "reviewed-single", "--library", root, "--json"]);

      const result = vpr([
        "complete", "childrens/fairy-tales/ep", "brief", "--pipeline", "reviewed-single",
        "--outputs", "artifacts/brief.md", "--library", root, "--json", "--dry-run",
      ]);

      expect(result.json().status).toBe("awaiting_review");
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

  describe("vpr status reports the journal", () => {
    it("reports pending for a stage with real artifacts and an empty journal", async () => {
      // This is the change with the largest blast radius on this branch:
      // every episode under library/ has real artifacts on disk and no
      // journal, and the old file-existence check called every one of them
      // complete. All three facts are asserted below, not just the first
      // and the last: the artifact exists, the journal is empty (or, as
      // here, absent — `episodeFixture()` never writes one), and only given
      // both of those does `pending` mean what this test claims it means
      // rather than a bug this test would otherwise hide.
      const { root, dir } = await episodeFixture();
      await writeFile(path.join(dir, "artifacts/brief.md"), "a brief written before journals existed");
      await expect(readJournal(dir)).rejects.toThrow();

      const result = vpr(["status", "childrens/fairy-tales/ep", "--library", root, "--json"]);

      expect(result.status).toBe(0);
      const out = result.json();
      const brief = out.stages.find((s: { stageId: string }) => s.stageId === "brief");
      expect(brief.status).toBe("pending");
      expect(brief.state).toBe("runnable");
    });

    it("reports a claimed stage as running, with its holder and expiry", async () => {
      const { root } = await episodeFixture();
      vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);

      const result = vpr(["status", "childrens/fairy-tales/ep", "--library", root, "--json"]);

      const out = result.json();
      const brief = out.stages.find((s: { stageId: string }) => s.stageId === "brief");
      expect(brief.state).toBe("running");
      expect(brief.lease.state).toBe("live");
      expect(brief.lease.holder).toMatch(/^cli\/pid-/);
    });

    it("no longer reports a budget it cannot measure", async () => {
      const { root } = await episodeFixture();

      const result = vpr(["status", "childrens/fairy-tales/ep", "--library", root, "--json"]);

      expect(result.json().budget).toBeUndefined();
    });
  });
});

// ── rerun ────────────────────────────────────────────────────────────────────
//
// `cmdRerun` used to print `Rerun plan (<mode>): 0 stage(s)` with an empty
// `stages` array, unconditionally, for every mode and every episode — it never
// planned anything. It now asks `ExecutionService.planRerun`, which replays
// the journal into the same stage map `status` uses. `rerun-affected-downstream`
// used to be refused by name (avg-33r, before staleness propagation existed);
// avg-qr4.3 task 9 gave the service a `StalenessReport` to compute for it from
// `--stages`, so it is refused only when no stages are named — nothing to
// propagate staleness FROM. The CLI's old default, `rerun-affected`, still
// matches no `RerunMode` member and is refused, pointing at the real name.

describe("vpr rerun", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  const PIPELINES = path.resolve(__dirname, "../../../pipelines/pipelines");

  function vpr(args: string[], env: Record<string, string> = {}) {
    const result = spawnSync("node", [cliPath, ...args], {
      encoding: "utf-8",
      // An absent key file unless a test says otherwise: every command now
      // resolves the operator key (avg-qr4.3), and the default location is
      // the developer's real one.
      env: { ...process.env, AVG_BUILTIN_PIPELINES: PIPELINES,
             AVG_OPERATOR_KEY_FILE: path.join(tmpdir(), "vpr-cli-no-operator-key"), ...env },
    });
    return {
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
      status: result.status ?? 1,
      json: () => JSON.parse(result.stdout?.toString() ?? "{}"),
    };
  }

  async function episodeFixture() {
    const root = await mkdtemp(path.join(tmpdir(), "vpr-cli-rerun-"));
    roots.push(root);
    const dir = path.join(root, "childrens", "series", "fairy-tales", "episodes", "ep");
    await mkdir(path.join(dir, "artifacts"), { recursive: true });
    return { root, dir };
  }

  it("names the stages it would rerun, rather than reporting zero", async () => {
    const { root, dir } = await episodeFixture();
    vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);
    await writeFile(path.join(dir, "artifacts/brief.md"), "a brief");
    vpr([
      "complete", "childrens/fairy-tales/ep", "brief",
      "--outputs", "artifacts/brief.md", "--library", root, "--json",
    ]);

    const result = vpr([
      "rerun", "childrens/fairy-tales/ep", "--mode", "rerun-selected",
      "--stages", "brief", "--library", root, "--json", "--dry-run",
    ]);

    expect(result.status).toBe(0);
    expect(result.json().stages).toEqual(["brief"]);
  });

  it("refuses rerun-affected-downstream with no stages named", async () => {
    const { root } = await episodeFixture();

    const result = vpr([
      "rerun", "childrens/fairy-tales/ep", "--mode", "rerun-affected-downstream",
      "--library", root, "--json",
    ]);

    expect(result.status).toBe(1);
    expect(result.json().error).toMatch(/needs the stages that changed/);
  });

  it("plans rerun-affected-downstream given the stages that changed", async () => {
    const { root, dir } = await episodeFixture();
    vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);
    await writeFile(path.join(dir, "artifacts/brief.md"), "a brief");
    vpr([
      "complete", "childrens/fairy-tales/ep", "brief",
      "--outputs", "artifacts/brief.md", "--library", root, "--json",
    ]);

    const result = vpr([
      "rerun", "childrens/fairy-tales/ep", "--mode", "rerun-affected-downstream",
      "--stages", "brief", "--library", root, "--json", "--dry-run",
    ]);

    expect(result.status).toBe(0);
    expect(result.json().stages).toContain("brief");
  });

  it("refuses the mode string that never matched a mode", async () => {
    const { root } = await episodeFixture();

    const result = vpr([
      "rerun", "childrens/fairy-tales/ep", "--mode", "rerun-affected", "--library", root, "--json",
    ]);

    expect(result.status).toBe(1);
    expect(result.json().error).toMatch(/rerun-affected-downstream/);
  });

  it("defaults to retry-current when --mode is omitted, and plans nothing for a pending stage", async () => {
    // Distinct from the old defect: this "0 stage(s)" is a real computation —
    // `brief` is `pending`, not `failed` or `running`, so `retry-current`
    // correctly finds nothing to retry. The old code reported the same shape
    // of answer for every mode and every episode, including ones that had
    // never been touched, which is not this.
    const { root } = await episodeFixture();

    const result = vpr([
      "rerun", "childrens/fairy-tales/ep", "--library", root, "--json", "--dry-run",
    ]);

    expect(result.status).toBe(0);
    const out = result.json();
    expect(out.mode).toBe("retry-current");
    expect(out.stages).toEqual([]);
  });

  it("actually calls service.rerun for a selected, completed stage rather than only planning it", async () => {
    // The CLI injects no dispatcher (see `makeService`'s own comment) — that
    // is the gateway's job, not a terminal's — so `service.rerun`, which
    // performs via `run()`, refuses to dispatch and reports `blocked` for
    // every stage it is given. This still proves the plan reached the
    // service and drove a real (non-dry-run) call: a stage `blocked` for a
    // named, legible reason is a different outcome than the old code's
    // silent, always-empty "0 stage(s)".
    const { root, dir } = await episodeFixture();
    vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);
    await writeFile(path.join(dir, "artifacts/brief.md"), "a brief");
    vpr([
      "complete", "childrens/fairy-tales/ep", "brief",
      "--outputs", "artifacts/brief.md", "--library", root, "--json",
    ]);

    const result = vpr([
      "rerun", "childrens/fairy-tales/ep", "--mode", "rerun-selected",
      "--stages", "brief", "--library", root, "--json",
    ]);

    expect(result.status).toBe(0);
    const out = result.json();
    expect(out.stages).toEqual(["brief"]);
    expect(out.outcomes[0].stage).toBe("brief");
    expect(out.outcomes[0].status).toBe("blocked");
    expect(out.outcomes[0].reason).toMatch(/dispatcher/);
  });

  it("reads the episode from the positionals, not a value flag's argument", async () => {
    // The same trap `run`'s positional-parsing test guards against:
    // `remaining.find((a) => !a.startsWith("--"))` would take `--library`'s
    // value as the episode path.
    const { root } = await episodeFixture();

    const result = vpr([
      "rerun", "--library", root, "childrens/fairy-tales/ep", "--json", "--dry-run",
    ]);

    expect(result.status).toBe(0);
    expect(result.json().mode).toBe("retry-current");
  });

  it("refuses an unknown --stages id instead of silently rerunning zero stages", async () => {
    // This task's own defect, recreated one layer up: `planRerun` filters
    // `rerunSet` down to ids the pipeline declares before building entries,
    // so an unknown selected id used to vanish rather than fail —
    // `cmdRerun` then handed the already-filtered (empty) plan to
    // `service.rerun`, bypassing that method's own per-id validation
    // entirely. The result was "0 stage(s)", exit 0, for a request that
    // named a real (if misspelled) intent — exactly the shape of answer
    // this task exists to abolish. `service.planRerun` now validates
    // `selectedStages` against the resolved pipeline before the planner
    // ever sees them.
    const { root } = await episodeFixture();

    const result = vpr([
      "rerun", "childrens/fairy-tales/ep", "--mode", "rerun-selected",
      "--stages", "nonexistent-stage", "--library", root, "--json",
    ]);

    // Exit 1 (EX_USAGE), not 0 and not 2: STAGE_UNKNOWN is a mistyped
    // argument, and `exitCodeFor` says so.
    expect(result.status).toBe(1);
    const out = result.json();
    expect(out.error).toMatch(/STAGE_UNKNOWN/);
    expect(out.error).toMatch(/nonexistent-stage/);
    // Never present when the call was refused — the old bug's signature.
    expect(out.stages).toBeUndefined();
  });

  it("refuses --stages as the trailing token instead of crashing", async () => {
    // `remaining[stagesIdx + 1]!.split(",")` threw when `--stages` was the
    // last argument — a mistyped command line surfacing as a FATAL
    // (uncaught TypeError, EX_RUNTIME) rather than the usage error it is.
    // `--mode`, two lines above in the source, handles the identical shape
    // without asserting; this must match.
    const { root } = await episodeFixture();

    const result = vpr([
      "rerun", "childrens/fairy-tales/ep", "--mode", "rerun-selected",
      "--library", root, "--json", "--stages",
    ]);

    expect(result.status).toBe(1);
    expect(result.json().error).toMatch(/--stages/);
    // Not a FATAL: the process must not have thrown past `main`'s own
    // catch (which would print "FATAL:" and exit 2).
    expect(result.json().error).not.toMatch(/FATAL/);
  });

  it("refuses --stages for a mode that does not accept it, rather than discarding it", async () => {
    const { root } = await episodeFixture();

    const result = vpr([
      "rerun", "childrens/fairy-tales/ep", "--stages", "brief",
      "--library", root, "--json",
    ]);

    expect(result.status).toBe(1);
    const out = result.json();
    expect(out.error).toMatch(/--stages/);
    expect(out.error).toMatch(/rerun-selected/);
    expect(out.error).toMatch(/retry-current/);
  });

  it("reports which stages were actually attempted, not only which were planned", async () => {
    // `stages` is the plan; `service.rerun` stops at the first stage that
    // does not complete. Without `executed`, a JSON consumer cannot tell
    // the two apart without re-deriving it from `outcomes`.
    const { root, dir } = await episodeFixture();
    vpr(["run", "childrens/fairy-tales/ep", "--library", root, "--json"]);
    await writeFile(path.join(dir, "artifacts/brief.md"), "a brief");
    vpr([
      "complete", "childrens/fairy-tales/ep", "brief",
      "--outputs", "artifacts/brief.md", "--library", root, "--json",
    ]);

    const result = vpr([
      "rerun", "childrens/fairy-tales/ep", "--mode", "rerun-selected",
      "--stages", "brief", "--library", root, "--json",
    ]);

    expect(result.status).toBe(0);
    const out = result.json();
    expect(out.executed).toEqual(["brief"]);
  });
});
