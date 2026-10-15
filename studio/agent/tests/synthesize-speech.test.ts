import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * pva_synthesize_speech (avg-vzb): the worker's speakers named, the language
 * passed on, and a receipt beside each WAV saying which job, model and
 * speaker made it. The worker is a local fake answering POST /synthesize.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
let worker: Server;
let requests: Record<string, unknown>[];
let answer: (body: Record<string, unknown>) => [number, unknown];
const saved: Record<string, string | undefined> = {};
const narration = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode, "artifacts", "narration");

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "pva-speech-"));
  requests = [];
  const wav = join(root, "worker-out.wav");
  writeFileSync(wav, "RIFF fake wav");
  answer = (body) => [200, {
    ok: true,
    result: {
      job_id: "tts-1", status: "completed", text_hash: "abc", duration_sec: 2.5, provider_mode: "live",
      actual_speaker: body.voice === "default" ? "ryan" : body.voice,
      model_path: "/models/qwen3-tts-1.7b-customvoice-8bit", model_identity_sha256: "937c",
      wav_path: wav, created_at: "2026-10-08T21:00:00Z", completed_at: "2026-10-08T21:00:03Z",
    },
  }];
  worker = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      requests.push(body);
      const [status, out] = answer(body);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise<void>((resolve) => worker.listen(0, "127.0.0.1", resolve));
  for (const name of ["AVG_LIBRARY_ROOT", "AVG_TTS_WORKER_URL"]) saved[name] = process.env[name];
  process.env.AVG_LIBRARY_ROOT = root;
  process.env.AVG_TTS_WORKER_URL = `http://127.0.0.1:${(worker.address() as { port: number }).port}`;
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

async function tools() {
  const { registerCapabilityTools } = await import("../src/capability-tools.js");
  const map = new Map<string, { description: string; parameters: any; execute: (...a: unknown[]) => Promise<any> }>();
  registerCapabilityTools({ registerTool: (t: { name: string }) => map.set(t.name, t as never) } as never);
  return map;
}
async function synthesize(params: Record<string, unknown>) {
  return (await tools()).get("pva_synthesize_speech")!.execute("call-1", { ...REF, ...params }, undefined, undefined, undefined);
}

describe("pva_synthesize_speech", () => {
  it("names the worker's speakers and languages, not a stale example", async () => {
    const tool = (await tools()).get("pva_synthesize_speech")!;
    const schema = JSON.stringify(tool.parameters);
    expect(schema).not.toContain("af_heart");
    for (const name of ["serena", "ryan", "uncle_fu", "italian"]) expect(schema).toContain(name);
  });

  it("passes the language on, and keeps a receipt beside the WAV", async () => {
    const result = await synthesize({ sceneId: "guida-1", text: "Il lampo.", voice: "serena", language: "italian", instruct: "calma" });
    expect(result.isError).toBeFalsy();
    expect(requests[0]).toMatchObject({ text: "Il lampo.", voice: "serena", language: "italian", instruct: "calma" });
    const receipt = JSON.parse(readFileSync(join(narration(), "guida-1.synthesis.json"), "utf-8"));
    expect(receipt).toMatchObject({
      provider: "qwen-local", jobId: "tts-1", model: "qwen3-tts-1.7b-customvoice-8bit", modelIdentitySha256: "937c",
      requestedVoice: "serena", speaker: "serena", language: "italian", instruct: "calma", text: "Il lampo.",
      wav: "artifacts/narration/guida-1.wav", durationSeconds: 2.5, createdAt: "2026-10-08T21:00:03Z",
    });
    expect(receipt.wavSha256).toBe(createHash("sha256").update(readFileSync(join(narration(), "guida-1.wav"))).digest("hex"));
    expect(result.content[0].text).toContain("serena (italian)");
  });

  it("passes temperature and repetition penalty to a preset voice too, and keeps them in the receipt", async () => {
    const result = await synthesize({ sceneId: "n2", text: "Hello.", voice: "serena", temperature: 0.8, repetitionPenalty: 1.2 });
    expect(result.isError).toBeFalsy();
    expect(requests[0]).toMatchObject({ temperature: 0.8, repetition_penalty: 1.2 });
    const receipt = JSON.parse(readFileSync(join(narration(), "n2.synthesis.json"), "utf-8"));
    expect(receipt.sampling).toEqual({ temperature: 0.8, repetitionPenalty: 1.2 });
  });

  it("records the speaker an alias resolved to, and 'auto' when no language was named", async () => {
    await synthesize({ sceneId: "n1", text: "Hello." });
    expect(requests[0]).not.toHaveProperty("language");
    const receipt = JSON.parse(readFileSync(join(narration(), "n1.synthesis.json"), "utf-8"));
    expect([receipt.requestedVoice, receipt.speaker, receipt.language]).toEqual(["default", "ryan", "auto"]);
  });

  it("says the worker's own error for a failed job, and writes nothing", async () => {
    answer = () => [200, { ok: false, result: { job_id: "tts-2", status: "failed", wav_path: null, error: "ValueError: Unknown CustomVoice speaker 'nobody'" } }];
    const result = await synthesize({ sceneId: "n2", text: "Hello.", voice: "nobody" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown CustomVoice speaker 'nobody'");
    expect(existsSync(join(narration(), "n2.wav"))).toBe(false);
  });

  it("refuses a scene id that is not a plain name", async () => {
    const result = await synthesize({ sceneId: "../x", text: "Hello." });
    expect(result.isError).toBe(true);
    expect(requests).toHaveLength(0);
  });
});
