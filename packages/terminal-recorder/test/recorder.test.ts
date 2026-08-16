import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { record, probe, ensureOutputDirective, TerminalRecorderError } from "../src/index.js";

/**
 * Terminal recording lived inline in the studio agent as execSync("vhs …"),
 * tangled with episode paths, so `terminal.record` was a capability nothing
 * could provide. These cover the parts that do not need vhs installed; the
 * recording itself is exercised only when it is.
 */
describe("terminal recorder", () => {
  function scratch(): string {
    return mkdtempSync(join(tmpdir(), "recorder-"));
  }

  describe("ensureOutputDirective", () => {
    it("adds an Output directive when the tape has none", () => {
      // A tape with no Output writes out.gif, somewhere the caller never looks.
      const tape = ensureOutputDirective('Type "hello"\nEnter\n', "scene.mp4");
      assert.match(tape, /^Output scene\.mp4\n/);
      assert.match(tape, /Type "hello"/);
    });

    it("replaces an Output pointing somewhere else", () => {
      const tape = ensureOutputDirective('Output /tmp/elsewhere.gif\nType "hi"\n', "scene.mp4");
      assert.match(tape, /^Output scene\.mp4\n/);
      assert.ok(!tape.includes("elsewhere.gif"), "the old destination must not survive");
    });

    it("keeps the rest of the tape intact", () => {
      const body = 'Set FontSize 32\nType "make build"\nEnter\nSleep 2s\n';
      const tape = ensureOutputDirective(body, "a.mp4");
      for (const line of body.trim().split("\n")) {
        assert.ok(tape.includes(line), `lost: ${line}`);
      }
    });

    it("ends with a newline, so vhs does not see a truncated last directive", () => {
      assert.ok(ensureOutputDirective('Type "x"', "a.mp4").endsWith("\n"));
    });
  });

  describe("probe", () => {
    it("reports unavailable for a recorder that does not exist", () => {
      const result = probe({ vhsPath: "/nonexistent/vhs" });
      assert.equal(result.available, false);
      // The message must say how to fix it, not merely that it failed.
      assert.match(result.detail, /brew install/);
    });
  });

  describe("record", () => {
    it("reports a missing recorder clearly rather than a raw ENOENT", () => {
      const dir = scratch();
      try {
        assert.throws(
          () =>
            record(
              { tape: { content: 'Type "hi"\n' }, outputPath: join(dir, "out.mp4") },
              { vhsPath: "/nonexistent/vhs" },
            ),
          (err: unknown) => {
            assert.ok(err instanceof TerminalRecorderError);
            assert.equal(err.code, "RECORDER_MISSING");
            assert.match(err.detail, /brew install/);
            return true;
          },
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("reports an unreadable tape path", () => {
      const dir = scratch();
      try {
        assert.throws(
          () =>
            record({
              tape: { path: join(dir, "missing.tape") },
              outputPath: join(dir, "out.mp4"),
            }),
          (err: unknown) => {
            assert.ok(err instanceof TerminalRecorderError);
            assert.equal(err.code, "TAPE_UNREADABLE");
            return true;
          },
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("reads a tape from disk", () => {
      const dir = scratch();
      try {
        const tapePath = join(dir, "in.tape");
        writeFileSync(tapePath, 'Type "from disk"\n');

        // vhs is absent here, so this fails at the spawn — after the tape has
        // been read and written, which is what this asserts.
        try {
          record({ tape: { path: tapePath }, outputPath: join(dir, "out.mp4") },
            { vhsPath: "/nonexistent/vhs" });
        } catch { /* expected */ }

        const written = join(dir, "out.tape");
        assert.ok(existsSync(written), "the tape must be kept beside the recording");
        assert.match(readFileSync(written, "utf-8"), /from disk/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
