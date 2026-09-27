import { describe, expect, it } from "vitest";
import { credentialFor } from "../../src/lib/gateway.svelte";

describe("which credential the studio presents (avg-qr4.3)", () => {
  it("prefers a stored operator key", () =>
    expect(credentialFor({ getItem: (k) => (k === "vs-operator-key" ? "op" : null) }, "", "tok")).toBe("op"));

  it("uses the dev operator key when none is stored", () =>
    expect(credentialFor({ getItem: () => null }, "op-dev", "tok")).toBe("op-dev"));

  it("falls back to the agent token: approvals then become requests, which is the safe failure", () =>
    expect(credentialFor({ getItem: () => null }, "", "tok")).toBe("tok"));

  it("prefers a stored gateway token over the built-in one when there is no operator credential", () =>
    expect(
      credentialFor({ getItem: (k) => (k === "vs-gateway-token" ? "stored-tok" : null) }, "", "tok"),
    ).toBe("stored-tok"));
});
