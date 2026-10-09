import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** pva_synthesize_speech with an enrolled clone voice (voice: clone:<id>), against a fake worker. */

const VOICE = "10091840-f656-4f0e-b300-8618473c7bf7";
let root: string;
let worker: Server;
const calls: { url: string; body: any }[] = [];
const env = { library: process.env.AVG_LIBRARY_ROOT, worker: process.env.AVG_TTS_WORKER_URL };

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "clone-speech-"));
  mkdirSync(join(root, "poesia", "sources", "novembre"), { recursive: true });
  const wav = join(root, "out.wav");
  writeFileSync(wav, Buffer.from("RIFF fake wav"));
  calls.length = 0;
  worker = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls.push({ url: req.url!, body: raw ? JSON.parse(raw) : null });
      res.writeHead(req.url === `/voices/${VOICE}/synthesize` ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url === `/voices/${VOICE}/synthesize` ? {
        synthesis_id: "s1", voice_id: VOICE, voice_revision_sha256: "a".repeat(64), provider_mode: "live", model_size: "1.7B", model_profile: "base",
        model_revision: "r1", model_identity_sha256: "b".repeat(64), reference_audio_sha256: "c".repeat(64), reference_text_sha256: "d".repeat(64),
        seed: 7, wav_path: wav, wav_sha256: createHash("sha256").update(readFileSync(wav)).digest("hex"), duration_seconds: 8.5, created_at: "2026-10-09T20:00:00Z", warning: null,
      } : { error: "Voice profile not found" }));
    });
  });
  await new Promise<void>((r) => worker.listen(0, "127.0.0.1", r));
  process.env.AVG_LIBRARY_ROOT = root;
  process.env.AVG_TTS_WORKER_URL = `http://127.0.0.1:${(worker.address() as { port: number }).port}`;
});
afterEach(async () => {
  await new Promise<void>((r) => worker.close(() => r()));
  rmSync(root, { recursive: true, force: true });
  for (const [k, v] of [["AVG_LIBRARY_ROOT", env.library], ["AVG_TTS_WORKER_URL", env.worker]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

async function tool(name: string) {
  const { registerCapabilityTools } = await import("../src/capability-tools.js");
  const registered = new Map<string, any>();
  registerCapabilityTools({ registerTool: (t: { name: string }) => registered.set(t.name, t), on: () => undefined } as never);
  return (params: Record<string, unknown>) => registered.get(name)!.execute("call", params, undefined, () => undefined, {});
}

describe("a clone voice", () => {
  it("speaks through the worker's clone synthesis, and its receipt names the voice's revision and reference", async () => {
    const run = await tool("pva_synthesize_speech");
    const made = await run({ channel: "poesia", source: "novembre", sceneId: "recita-01", text: "Gemmea l'aria", voice: `clone:${VOICE}`, language: "italian", seed: 7 });
    expect(made.isError, made.content[0].text).toBeUndefined();
    expect(calls[0]).toEqual({ url: `/voices/${VOICE}/synthesize`, body: { text: "Gemmea l'aria", language: "italian", model_size: "1.7B", seed: 7 } });
    const receipt = JSON.parse(readFileSync(join(root, "poesia", "sources", "novembre", "artifacts", "narration", "recita-01.synthesis.json"), "utf-8"));
    expect(receipt).toMatchObject({ method: "voice-clone", voice: { id: VOICE, revisionSha256: "a".repeat(64), referenceAudioSha256: "c".repeat(64) }, model: { profile: "base", size: "1.7B" }, seed: 7, durationSeconds: 8.5 });
    expect(existsSync(join(root, "poesia", "sources", "novembre", "artifacts", "narration", "recita-01.wav"))).toBe(true);
  });

  it("refuses a clone it does not know, and an instruction a clone cannot follow", async () => {
    const run = await tool("pva_synthesize_speech");
    const unknown = await run({ channel: "poesia", source: "novembre", sceneId: "x", text: "a", voice: "clone:00000000-0000-0000-0000-000000000000" });
    expect([unknown.isError, unknown.content[0].text]).toEqual([true, expect.stringContaining("Voice profile not found")]);
    const instruct = await run({ channel: "poesia", source: "novembre", sceneId: "x", text: "a", voice: `clone:${VOICE}`, instruct: "angrily" });
    expect(instruct.content[0].text).toContain("takes no instruct");
    const bad = await run({ channel: "poesia", source: "novembre", sceneId: "x", text: "a", voice: "clone:marcello" });
    expect(bad.content[0].text).toContain("pva_voices");
  });
});
