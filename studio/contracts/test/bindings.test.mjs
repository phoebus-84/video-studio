import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bindingsDir = resolve(__dirname, "../bindings/ts");

function readBinding(name) {
  return readFileSync(resolve(bindingsDir, `${name}.ts`), "utf-8");
}

describe("TypeScript bindings", () => {
  it("generates one .ts file per schema", () => {
    const expected = [
      "asset", "capability-binding", "edit-timeline", "editorial-artifact",
      "error-envelope", "identity", "journal-event", "pipeline-manifest",
      "narration", "provider-job", "review-thread", "vocabulary", "workspace",
    ];
    for (const name of expected) {
      assert.ok(existsSync(resolve(bindingsDir, `${name}.ts`)), `Missing binding: ${name}.ts`);
    }
  });

  it("generates capability enum with image.generate", () => {
    const content = readBinding("vocabulary");
    assert.ok(content.includes('"image.generate"'), "vocabulary.ts should contain image.generate");
    assert.ok(content.includes('"speech.synthesize"'), "vocabulary.ts should contain speech.synthesize");
  });

  it("generates journal event type with stage.started", () => {
    const content = readBinding("journal-event");
    assert.ok(content.includes('"stage.started"'), "journal-event.ts should contain stage.started");
    assert.ok(content.includes('"episode.created"'), "journal-event.ts should contain episode.created");
  });

  it("generates review thread status with open, resolved, wontfix", () => {
    const content = readBinding("review-thread");
    assert.ok(content.includes('"open"'), "review-thread.ts should contain open");
    assert.ok(content.includes('"resolved"'), "review-thread.ts should contain resolved");
    assert.ok(content.includes('"wontfix"'), "review-thread.ts should contain wontfix");
  });

  it("generates provider job status with submitted, completed, failed", () => {
    const content = readBinding("provider-job");
    assert.ok(content.includes('"submitted"'), "provider-job.ts should contain submitted");
    assert.ok(content.includes('"completed"'), "provider-job.ts should contain completed");
    assert.ok(content.includes('"failed"'), "provider-job.ts should contain failed");
    assert.ok(content.includes('"cancelled"'), "provider-job.ts should contain cancelled");
  });

  it("generates capability binding with in-proc and http transport", () => {
    const content = readBinding("capability-binding");
    assert.ok(content.includes('"in-proc"'), "capability-binding.ts should contain in-proc");
    assert.ok(content.includes('"http"'), "capability-binding.ts should contain http");
  });

  it("generates identity with ContentHash pattern", () => {
    const content = readBinding("identity");
    assert.ok(content.includes("ContentHash"), "identity.ts should contain ContentHash");
    assert.ok(content.includes("ChannelId"), "identity.ts should contain ChannelId");
    assert.ok(content.includes("Provenance"), "identity.ts should contain Provenance");
  });

  it("generates canonical narration manifests and legacy read compatibility", () => {
    const content = readBinding("narration");
    assert.ok(content.includes("NarrationSegment"));
    assert.ok(content.includes("SynthesisAttempt"));
    assert.ok(content.includes("SegmentQualityReport"));
    assert.ok(content.includes("NarrationManifest"));
    assert.ok(content.includes("LegacyNarrationSidecar"));
  });

  it("workspace has imports from identity", () => {
    const content = readBinding("workspace");
    assert.ok(content.includes("./identity"), "workspace.ts should import from identity");
  });

  it("generates the v1alpha2 edit timeline in its own directory", () => {
    const path = resolve(bindingsDir, "v1alpha2/edit-timeline.ts");
    assert.ok(existsSync(path), "Missing binding: v1alpha2/edit-timeline.ts");
    const content = readFileSync(path, "utf-8");
    assert.ok(content.includes('apiVersion: "studio.video/v1alpha2";'));
    assert.ok(content.includes("items: (VisualItem | AudioItem)[];"), "array of a union needs parentheses");
    assert.ok(content.includes("assets: Record<string, Asset>;"), "maps carry their value type");
  });

  it("generates word timing with speech spans as tuples", () => {
    const content = readBinding("word-timing");
    assert.ok(content.includes("export interface WordTiming {"));
    assert.ok(content.includes("export type SpeechSpan = [Seconds, Seconds];"), "prefixItems become a TS tuple");
  });

  it("generates the cue grammar as a union", () => {
    const content = readBinding("cue");
    assert.ok(content.includes("export type Cue = WordPattern | number | WordCue | LineCue | TakeCue | MarkCue;"));
  });

  it("generates the narration takes contract", () => {
    const content = readBinding("narration-takes");
    assert.ok(content.includes("export interface NarrationTakes {"));
    assert.ok(content.includes("holds?: Hold[];"));
  });
});
