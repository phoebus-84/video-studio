import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * pva_register_take (avg-dcf.6.6): Pi makes a synthesized file a take of
 * takes.json, in its unit. @studio/episode tests the registration itself.
 */

const REF = { channel: "dentro-i-versi", series: "short", episode: "il-lampo" };
let root: string;
let saved: string | undefined;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pva-register-"));
  mkdirSync(join(dir(), "artifacts", "narration"), { recursive: true });
  for (const [name, seconds] of [["titolo", 2], ["recita", 3]] as const) {
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=300:duration=${seconds}`, "-ac", "1", join(dir(), "artifacts", "narration", `${name}.wav`)]);
  }
  saved = process.env.AVG_LIBRARY_ROOT;
  process.env.AVG_LIBRARY_ROOT = root;
});

afterEach(() => {
  if (saved === undefined) delete process.env.AVG_LIBRARY_ROOT;
  else process.env.AVG_LIBRARY_ROOT = saved;
  rmSync(root, { recursive: true, force: true });
});

async function tool(params: Record<string, unknown>) {
  const { registerCapabilityTools } = await import("../src/capability-tools.js");
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<any> }>();
  registerCapabilityTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never) } as never);
  return tools.get("pva_register_take")!.execute("call-1", { ...REF, ...params }, undefined, undefined, undefined);
}

describe("pva_register_take", () => {
  it("registers the short's two takes in its recital unit", async () => {
    const first = await tool({ take: "titolo", audio: "artifacts/narration/titolo.wav", text: "Il lampo, di Giovanni Pascoli.", language: "it", provider: "qwen3-tts-local", voiceId: "Serena", unit: "recital" });
    expect(first.isError).toBeUndefined();
    expect(first.content[0].text).toMatch(/✅ take titolo: 2\.\d\ds → assets\/takes\/titolo\.[0-9a-f]{8}\.wav/);
    const second = await tool({ take: "recita", audio: "artifacts/narration/recita.wav", text: "E cielo e terra si mostrò qual era:", language: "it", provider: "qwen3-tts-local", voiceId: "Ryan", direction: "warm, unhurried legato", unit: "recital", pauseBefore: 1 });
    expect(second.content[0].text).toMatch(/unit recital: titolo → \+1s recita/);
    const doc = JSON.parse(readFileSync(join(dir(), "artifacts", "narration", "takes.json"), "utf-8"));
    expect(doc.units).toEqual([{ id: "recital", sequence: [{ take: "titolo" }, { take: "recita", pauseBefore: 1 }] }]);
    expect(doc.takes[1].voice).toEqual({ provider: "qwen3-tts-local", voiceId: "Ryan", direction: "warm, unhurried legato" });
  });

  it("says what is wrong with its code", async () => {
    const result = await tool({ take: "titolo", audio: "../elsewhere.wav", text: "x", provider: "qwen3-tts-local" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^❌ bad-audio: /);
  });
});
