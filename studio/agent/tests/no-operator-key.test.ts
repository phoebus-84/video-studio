// ---------------------------------------------------------------------------
// Guard: Pi must never be given, pointed at, or able to discover through its
// config the operator key file (avg-qr4.3 constraint). This is the one
// regression that would undo Task 10's whole design: if the agent's own
// source ever names the operator key file or its env var, Pi's process could
// read or point at it directly, bypassing the gateway's downgrade-to-request
// behavior entirely.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("no-operator-key", () => {
  it("nothing in the agent's source names the operator key", () => {
    const src = join(__dirname, "..", "src");
    for (const f of readdirSync(src, { recursive: true }) as string[]) {
      if (!/\.(ts|mjs|js)$/.test(f)) continue;
      const text = readFileSync(join(src, f), "utf-8");
      expect(text, f).not.toMatch(/operator-key|AVG_OPERATOR_KEY_FILE/);
    }
  });
});
