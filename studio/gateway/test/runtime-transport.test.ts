import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME = join(__dirname, "../src/runtime");

// ADR-0027: the gateway never produces artifacts. Its runtime layer composes
// the execution service with @studio/adapters' dispatcher and carries
// requests to it; the work itself, and every file it writes, lives in the
// adapters (avg-qr4.4). This is the guard against a handler growing back here.
describe("the gateway's runtime layer", () => {
  const sources = readdirSync(RUNTIME)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => ({ file, text: readFileSync(join(RUNTIME, file), "utf-8") }));

  it("writes no files", () => {
    for (const { file, text } of sources) {
      for (const write of ["writeFile", "copyFile", "appendFile", "mkdir(", "rename("]) {
        expect(text, `${file} calls ${write}`).not.toContain(write);
      }
    }
  });

  it("keeps no stage table of its own", () => {
    for (const { file, text } of sources) {
      expect(text, file).not.toMatch(/HANDLERS|GatewayDispatcher|handleQa|handleCaptions/);
    }
  });

  it("dispatches through the studio's adapters", () => {
    const service = sources.find(({ file }) => file === "service.ts")!.text;
    expect(service).toContain("createStudioDispatcher()");
  });
});
