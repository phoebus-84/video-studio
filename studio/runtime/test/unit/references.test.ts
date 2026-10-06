import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seriesPath, seriesReferencePath, seriesReferenceWithdrawalPath } from "@studio/contracts/src/layout.mjs";
import { verifyReceipt } from "@studio/contracts/src/receipt.mjs";
import { verifySeriesReference } from "@studio/contracts/src/series-references.mjs";
import { approveReference, listReferences, withdrawReference } from "../../src/references.js";
import { episodeDirOf, KEY, propose as proposeIn, REF } from "../helpers/reference-proposal.js";

/**
 * The operator's side of golden references (avg-jao.6), on a proposal laid
 * out as @studio/episode's proposeReference leaves it.
 */

let root: string;
const at = (relative: string) => join(episodeDirOf(root), relative);
const descriptor = (id = "morning-v1") => seriesReferencePath(root, REF.channel, REF.series, "poetry-short", id);
const propose = (id = "morning-v1") => proposeIn(root, id);

const verify = (key: string | null = KEY) =>
  verifySeriesReference({ seriesDir: seriesPath(root, REF.channel, REF.series), templateId: "poetry-short", referenceId: "morning-v1", key });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vpr-references-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("approveReference", () => {
  it("signs the proposal and promotes it: the descriptor is the proposal plus a verifiable approval", () => {
    const proposal = propose();
    const out = approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY, note: "the series' first standard" });
    if (!out.ok) throw new Error(JSON.stringify(out));
    expect(out.value.written).toBe(true);
    expect(out.value.path).toBe(descriptor());
    const written = JSON.parse(readFileSync(descriptor(), "utf-8"));
    const { approval, ...rest } = written;
    expect(rest).toEqual(proposal);
    expect(verifyReceipt(approval, KEY)).toBe(true);
    expect(approval.note).toBe("the series' first standard");
    expect(verify().state).toBe("trusted");
  });

  it("--dry-run verifies and writes nothing", () => {
    propose();
    const out = approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY, dryRun: true });
    if (!out.ok) throw new Error(JSON.stringify(out));
    expect(out.value.written).toBe(false);
    expect(out.value.verdict.state).toBe("trusted");
    expect(existsSync(descriptor())).toBe(false);
  });

  it("proposal-changed: what is approved is exactly what was proposed", () => {
    propose();
    writeFileSync(at("output/render-1-abcd1234.mp4"), "another render");
    const out = approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY });
    expect(out.ok ? null : out.code).toBe("proposal-changed");
    expect(existsSync(descriptor())).toBe(false);
  });

  it("reference-exists: a promoted reference is never rewritten", () => {
    propose();
    approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY });
    const before = readFileSync(descriptor());
    const out = approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY, note: "again" });
    expect(out.ok ? null : out.code).toBe("reference-exists");
    expect(readFileSync(descriptor())).toEqual(before);
  });

  it("no-operator-key: only the operator approves", () => {
    propose();
    const out = approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: null });
    expect(out.ok ? null : out.code).toBe("no-operator-key");
    expect(existsSync(descriptor())).toBe(false);
  });

  it("no-proposal", () => {
    const out = approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY });
    expect(out.ok ? null : out.code).toBe("no-proposal");
  });

  it("not-trusted: a proposal that would not verify is not written", () => {
    propose();
    // The release the frozen spec is pinned to disappears before approval.
    rmSync(join(seriesPath(root, REF.channel, REF.series), "templates/poetry-short/1.0.0"), { recursive: true });
    const out = approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY });
    expect(out.ok ? null : out.code).toBe("not-trusted");
    expect(out.ok ? [] : out.problems?.map((p) => p.code)).toEqual(["missing-release"]);
    expect(existsSync(descriptor())).toBe(false);
  });
});

describe("withdrawReference", () => {
  const withdraw = (key: string | null = KEY, reason = "the recital was re-recorded") =>
    withdrawReference({ libraryRoot: root, channel: REF.channel, series: REF.series, templateId: "poetry-short", referenceId: "morning-v1", key, reason });

  it("writes a signed withdrawal; the reference then verifies as withdrawn, its evidence kept", () => {
    propose();
    approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY });
    const out = withdraw();
    if (!out.ok) throw new Error(JSON.stringify(out));
    expect(out.value.path).toBe(seriesReferenceWithdrawalPath(root, REF.channel, REF.series, "poetry-short", "morning-v1"));
    expect(verify().state).toBe("withdrawn");
    expect(existsSync(descriptor())).toBe(true);
    expect(existsSync(at("reviews/references/morning-v1/episode-spec.json"))).toBe(true);
  });

  it("refuses a second withdrawal, a missing reason, a missing reference, no key", () => {
    expect((withdraw() as { code: string }).code).toBe("missing-reference");
    propose();
    approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY });
    expect((withdraw(KEY, " ") as { code: string }).code).toBe("no-reason");
    expect((withdraw(null) as { code: string }).code).toBe("no-operator-key");
    expect(withdraw().ok).toBe(true);
    expect((withdraw() as { code: string }).code).toBe("already-withdrawn");
  });
});

describe("listReferences", () => {
  it("lists every reference of the series with its state", () => {
    propose("morning-v1");
    approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v1", key: KEY });
    propose("morning-v2");
    approveReference({ libraryRoot: root, ref: REF, referenceId: "morning-v2", key: KEY });
    withdrawReference({ libraryRoot: root, channel: REF.channel, series: REF.series, templateId: "poetry-short", referenceId: "morning-v1", key: KEY, reason: "superseded by v2" });
    const listed = listReferences({ libraryRoot: root, channel: REF.channel, series: REF.series, key: KEY });
    expect(listed.map((r) => [r.templateId, r.referenceId, r.verdict.state])).toEqual([
      ["poetry-short", "morning-v1", "withdrawn"],
      ["poetry-short", "morning-v2", "trusted"],
    ]);
    expect(listReferences({ libraryRoot: root, channel: REF.channel, series: REF.series, key: null }).map((r) => r.verdict.state))
      .toEqual(["unverifiable", "unverifiable"]);
  });
});
