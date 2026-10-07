import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { specEpisode } from "@studio/episode/testing";

/**
 * pva_align_take (avg-8hs.2): Pi measures a take's word timing. The voice
 * worker is a local fake answering POST /align; @studio/episode tests the
 * alignment itself, ElevenLabs and the spend ledger.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
let worker: Server;
const saved: Record<string, string | undefined> = {};
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);

function audio(path: string, _take: string, seconds: number): void {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=300:duration=${seconds}`, "-ac", "1", path]);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "pva-align-"));
  specEpisode(dir(), REF, { audio });
  worker = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const tokens = String(JSON.parse(raw).text).split(/\s+/);
      const step = 2.6 / tokens.length;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ words: tokens.map((text, i) => ({ text, start: i * step, end: (i + 1) * step })), model: "mlx-community/Qwen3-ForcedAligner-0.6B-8bit", language: "English" }));
    });
  });
  await new Promise<void>((resolve) => worker.listen(0, "127.0.0.1", resolve));
  for (const name of ["AVG_LIBRARY_ROOT", "AVG_TTS_WORKER_URL", "ELEVENLABS_API_KEY"]) saved[name] = process.env[name];
  process.env.AVG_LIBRARY_ROOT = root;
  process.env.AVG_TTS_WORKER_URL = `http://127.0.0.1:${(worker.address() as { port: number }).port}`;
  delete process.env.ELEVENLABS_API_KEY;
});

afterEach(async () => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  worker.closeAllConnections();
  await new Promise<void>((resolve) => worker.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

async function tool(params: Record<string, unknown>) {
  const { registerCapabilityTools } = await import("../src/capability-tools.js");
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<any> }>();
  registerCapabilityTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never) } as never);
  return tools.get("pva_align_take")!.execute("call-1", { ...REF, ...params }, undefined, undefined, undefined);
}

describe("pva_align_take", () => {
  it("aligns a take with the local aligner and says where the timing went", async () => {
    const result = await tool({ take: "light", language: "en" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/^✅ light: 6 words, qwen-local \(mlx-community\/Qwen3-ForcedAligner-0\.6B-8bit\) → artifacts\/timing\/light\.json/);
    const timing = JSON.parse(readFileSync(join(dir(), "artifacts/timing/light.json"), "utf-8"));
    expect(timing.alignment.provider).toBe("qwen-local");
  });

  it("replies with the error's code", async () => {
    const result = await tool({ take: "light" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^❌ no-language: take "light" has no language/);
    expect(result.details.code).toBe("no-language");
  });

  it("never reaches ElevenLabs without its key", async () => {
    const result = await tool({ take: "light", language: "en", provider: "elevenlabs" });
    expect(result.content[0].text).toMatch(/^❌ no-key: ElevenLabs needs its API key \(ELEVENLABS_API_KEY\)/);
  });
});
