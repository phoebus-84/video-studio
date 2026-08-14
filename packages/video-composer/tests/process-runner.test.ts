/**
 * Tests for the argv-only process runner.
 *
 * Uses fake process spawning to test success, failure, cancellation,
 * timeout, and path handling without executing real binaries.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import { runProcess } from "../src/process-runner.js";
import { ProcessCancelledError, ProcessTimeoutError } from "../src/types.js";
import {
  installFakeSpawn,
  uninstallFakeSpawn,
  setFake,
  clearFakes,
  clearRecordedCalls,
  getRecordedCalls,
} from "./fixtures/fake-ffmpeg.js";

describe("runProcess", () => {
  beforeEach(() => {
    installFakeSpawn();
    clearFakes();
    clearRecordedCalls();
  });

  afterEach(() => {
    uninstallFakeSpawn();
  });

  it("runs a process and captures stdout", async () => {
    setFake("echo", { stdout: "hello world\n", exitCode: 0 });
    const result = await runProcess("echo", ["hello", "world"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello world\n");
    expect(result.cancelled).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("passes arguments without shell interpolation", () => {
    // We verify via recorded calls
    setFake("ffmpeg", { stdout: "", exitCode: 0 });
    return runProcess("ffmpeg", [
      "-i",
      "/path/with spaces/video.mp4",
      "-vf",
      "scale=1280:720",
    ]).then((result) => {
      expect(result.exitCode).toBe(0);
      const calls = getRecordedCalls();
      expect(calls.length).toBe(1);
      expect(calls[0].command).toBe("ffmpeg");
      // Each arg is a separate array element — no shell joining
      expect(calls[0].args).toEqual([
        "-i",
        "/path/with spaces/video.mp4",
        "-vf",
        "scale=1280:720",
      ]);
      expect(calls[0].options.detached).toBe(process.platform !== "win32");
    });
  });

  it("handles paths with spaces", async () => {
    setFake("ffmpeg", { stdout: "", exitCode: 0 });
    const result = await runProcess("ffmpeg", [
      "-i",
      "/Users/test/My Videos/clip.mp4",
    ]);
    expect(result.exitCode).toBe(0);
    const calls = getRecordedCalls();
    // The space-containing path is a single arg — no quoting bugs
    expect(calls[0].args[1]).toBe("/Users/test/My Videos/clip.mp4");
  });

  it("handles Unicode paths", async () => {
    setFake("ffmpeg", { stdout: "", exitCode: 0 });
    const result = await runProcess("ffmpeg", [
      "-i",
      "/Users/test/Видео/файл.mp4",
    ]);
    expect(result.exitCode).toBe(0);
    const calls = getRecordedCalls();
    expect(calls[0].args[1]).toBe("/Users/test/Видео/файл.mp4");
  });

  it("captures stderr by default", async () => {
    setFake("ffmpeg", {
      stdout: "",
      stderr: "Warning: something\n",
      exitCode: 1,
    });
    const result = await runProcess("ffmpeg", ["-i", "bad.mp4"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Warning");
  });

  it("does not capture stderr when disabled", async () => {
    setFake("ffmpeg", {
      stdout: "",
      stderr: "Warning: something\n",
      exitCode: 1,
    });
    const result = await runProcess("ffmpeg", ["-i", "bad.mp4"], {
      captureStderr: false,
    });
    expect(result.stderr).toBe("");
  });

  it("supports cancellation via AbortSignal", async () => {
    // Use a very long delay so the process is still running when we abort
    setFake("ffmpeg", { stdout: "partial output", exitCode: 0, delayMs: 10000 });

    const controller = new AbortController();
    // Abort quickly — before the close event fires
    setTimeout(() => controller.abort(), 5);

    // When the process is killed by signal, it resolves (not rejects)
    // with cancelled: true and partial output
    const result = await runProcess("ffmpeg", ["-i", "input.mp4"], {
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    expect(result.signal).toBe("SIGTERM");
  });

  it("handles already-aborted signal at spawn time", async () => {
    setFake("ffmpeg", { stdout: "", exitCode: 0 });
    const controller = new AbortController();
    controller.abort();

    await expect(
      runProcess("ffmpeg", ["-i", "input.mp4"], { signal: controller.signal }),
    ).rejects.toThrow(ProcessCancelledError);
  });

  it("supports timeout", async () => {
    // Set a fake with long delay and a short timeout
    setFake("ffmpeg", { stdout: "", exitCode: 0, delayMs: 5000 });

    await expect(
      runProcess("ffmpeg", ["-i", "input.mp4"], { timeoutMs: 10 }),
    ).rejects.toThrow(ProcessTimeoutError);
  });

  it("redacts secrets from stdout and stderr", async () => {
    setFake("ffmpeg", {
      stdout: "secret-token-abc123 output",
      stderr: "token: secret-token-abc123",
      exitCode: 0,
    });
    const result = await runProcess("ffmpeg", ["-i", "input.mp4"], {
      redact: ["secret-token-abc123"],
    });
    expect(result.stdout).not.toContain("secret-token-abc123");
    expect(result.stdout).toContain("[REDACTED]");
    expect(result.stderr).not.toContain("secret-token-abc123");
    expect(result.stderr).toContain("[REDACTED]");
  });

  it("records process duration", async () => {
    setFake("ffmpeg", { stdout: "", exitCode: 0 });
    const result = await runProcess("ffmpeg", ["-version"]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
