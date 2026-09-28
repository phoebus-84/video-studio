import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { credentialFor, saveOperatorKey, OPERATOR_KEY_STORAGE } from "../../src/lib/gateway.svelte";

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => { items.set(k, v); },
    removeItem: (k: string) => { items.delete(k); },
    items,
  };
}

describe("which credential the studio presents (avg-qr4.3)", () => {
  it("prefers a stored operator key", () =>
    expect(credentialFor({ getItem: (k) => (k === "vs-operator-key" ? "op" : null) }, "tok")).toBe("op"));

  it("falls back to the agent token: approvals then become requests, which is the safe failure", () =>
    expect(credentialFor({ getItem: () => null }, "tok")).toBe("tok"));

  it("prefers a stored gateway token over the built-in one when there is no operator credential", () =>
    expect(
      credentialFor({ getItem: (k) => (k === "vs-gateway-token" ? "stored-tok" : null) }, "tok"),
    ).toBe("stored-tok"));
});

// avg-qr4.3 final review, I1: the operator key used to be inlined into the
// modules the dev server serves over unauthenticated HTTP (`curl
// localhost:5173/src/lib/gateway.svelte.ts` printed it), and VITE_OPERATOR_KEY
// baked it into production bundles. The person enters it once instead.
describe("the operator key is entered, never built in", () => {
  it("is stored under vs-operator-key, trimmed, and an empty entry forgets it", () => {
    const storage = memoryStorage({ "vs-operator-key": "old" });
    expect(OPERATOR_KEY_STORAGE).toBe("vs-operator-key");
    saveOperatorKey(storage, "  pasted-key\n");
    expect(storage.items.get("vs-operator-key")).toBe("pasted-key");
    saveOperatorKey(storage, "   ");
    expect(storage.items.has("vs-operator-key")).toBe(false);
  });

  it("appears nowhere in the build config or the served source", () => {
    const root = resolve(__dirname, "../..");
    const files = [join(root, "vite.config.ts")];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(join(root, "src"));

    const offenders = files.filter((file) =>
      /__OPERATOR_KEY__|VITE_OPERATOR_KEY|\.operator-key/.test(readFileSync(file, "utf-8")));
    expect(offenders).toEqual([]);
  });

  it("is typed into a password field", () => {
    const source = readFileSync(resolve(__dirname, "../../src/components/shell/OperatorKeyControl.svelte"), "utf-8");
    expect(source).toMatch(/<input[^>]*type="password"/);
    expect(source).not.toMatch(/console\.(log|info|debug|warn|error)/);
  });
});
