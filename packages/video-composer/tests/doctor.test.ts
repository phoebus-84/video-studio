/**
 * Tests for the doctor diagnostic tool.
 *
 * Uses fake process spawning to verify that the doctor reports
 * exact codecs and filters as required/unavailable.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runDoctor } from "../src/doctor.js";
import {
  installFakeSpawn,
  uninstallFakeSpawn,
  setFake,
  clearFakes,
  clearRecordedCalls,
  FAKE_FFMPEG_VERSION,
  FAKE_FFMPEG_CODECS,
  FAKE_FFMPEG_FILTERS,
} from "./fixtures/fake-ffmpeg.js";

describe("runDoctor", () => {
  beforeEach(() => {
    installFakeSpawn();
    clearFakes();
    clearRecordedCalls();
  });

  afterEach(() => {
    uninstallFakeSpawn();
  });

  it("reports that FFmpeg is not found when no binary is on PATH", async () => {
    // No ffmpeg fake → `command -v ffmpeg` returns non-zero
    // The /bin/sh fake needs to return nothing
    setFake("/bin/sh", { stdout: "", exitCode: 1 });

    const report = await runDoctor();
    expect(report.ffmpeg).toBeNull();
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors.some((e) => e.includes("not found"))).toBe(true);
  });

  it("reports required codecs and filters when FFmpeg is available", async () => {
    setFake("/bin/sh", { stdout: "/usr/local/bin/ffmpeg", exitCode: 0 });
    // Use empty-string catch-all for any ffmpeg path
    setFake("", {
      stdout: FAKE_FFMPEG_VERSION,
      exitCode: 0,
    });

    const report = await runDoctor(undefined, [], []);
    // With empty required lists, everything is satisfied
    expect(report.requiredCodecs.satisfied).toBe(true);
    expect(report.requiredFilters.satisfied).toBe(true);
  });

  it("correctly identifies missing codecs", async () => {
    setFake("/bin/sh", { stdout: "/usr/local/bin/ffmpeg", exitCode: 0 });
    setFake("", {
      stdout: FAKE_FFMPEG_VERSION,
      exitCode: 0,
    });

    const report = await runDoctor(
      undefined,
      ["libx264", "libx265", "nonexistent_codec"],
      [],
    );
    // With only version output, no codecs are found
    expect(report.requiredCodecs.satisfied).toBe(false);
    expect(report.requiredCodecs.missing.length).toBeGreaterThan(0);
    expect(report.requiredCodecs.missing).toContain("libx264");
    expect(report.requiredCodecs.missing).toContain("libx265");
  });

  it("correctly identifies missing filters", async () => {
    setFake("/bin/sh", { stdout: "/usr/local/bin/ffmpeg", exitCode: 0 });
    setFake("", {
      stdout: FAKE_FFMPEG_VERSION,
      exitCode: 0,
    });

    const report = await runDoctor(
      undefined,
      [],
      ["scale", "nonexistent_filter"],
    );
    expect(report.requiredFilters.satisfied).toBe(false);
    expect(report.requiredFilters.missing).toContain("scale");
  });

  it("emits structured logs through a provided logger", async () => {
    setFake("/bin/sh", { stdout: "/usr/local/bin/ffmpeg", exitCode: 0 });
    setFake("", {
      stdout: FAKE_FFMPEG_VERSION,
      exitCode: 0,
    });

    const messages: string[] = [];
    const logger = {
      debug: (m: string) => messages.push(`DEBUG:${m}`),
      info: (m: string) => messages.push(`INFO:${m}`),
      warn: (m: string) => messages.push(`WARN:${m}`),
      error: (m: string) => messages.push(`ERROR:${m}`),
    };

    await runDoctor(logger, [], []);
    expect(messages.some((m) => m.includes("FFmpeg found"))).toBe(true);
    expect(messages.some((m) => m.includes("All required codecs"))).toBe(true);
  });

  it("defaults required codecs and filters when not provided", async () => {
    setFake("/bin/sh", { stdout: "/usr/local/bin/ffmpeg", exitCode: 0 });
    setFake("", {
      stdout: FAKE_FFMPEG_VERSION,
      exitCode: 0,
    });

    const report = await runDoctor();
    // The default lists contain known codecs
    expect(report.requiredCodecs.required.length).toBeGreaterThan(0);
    expect(report.requiredFilters.required.length).toBeGreaterThan(0);
    expect(report.requiredCodecs.required).toContain("libx264");
    expect(report.requiredFilters.required).toContain("scale");
  });
});
