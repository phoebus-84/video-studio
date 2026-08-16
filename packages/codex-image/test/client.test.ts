import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { CodexImageClient } from "../src/client.js";
import { CodexImageError } from "../src/errors.js";

describe("CodexImageClient", () => {
  const TOKEN = (() => {
    const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${encode({ alg: "none" })}.${encode({
      "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" },
    })}.sig`;
  })();

  function sseResponse(events: unknown[], status = 200): Response {
    const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
    return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
  }

  const imageEvent = (payload = "PIXELS") => ({
    type: "response.output_item.done",
    item: { type: "image_generation_call", result: Buffer.from(payload).toString("base64") },
  });

  /** Records calls so a test can assert on what actually went over the wire. */
  function recorder(responses: Array<Response | (() => Response)>) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let index = 0;
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const next = responses[Math.min(index++, responses.length - 1)]!;
      return typeof next === "function" ? next() : next;
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  const noSleep = async () => {};

  describe("credentials", () => {
    it("refuses to construct without a token", () => {
      assert.throws(
        () => new CodexImageClient({ transport: { kind: "subscription", token: "" } }),
        (err: unknown) => (err as CodexImageError).code === "NO_CREDENTIAL",
      );
    });

    it("refuses to construct without an API key", () => {
      assert.throws(
        () => new CodexImageClient({ transport: { kind: "api", apiKey: "" } }),
        (err: unknown) => (err as CodexImageError).code === "NO_CREDENTIAL",
      );
    });
  });

  describe("subscription transport", () => {
    it("returns decoded bytes with provenance", async () => {
      const { impl, calls } = recorder([sseResponse([imageEvent("PIXELS")])]);
      const client = new CodexImageClient({
        transport: { kind: "subscription", token: TOKEN },
        fetchImpl: impl,
      });

      const image = await client.generate({ prompt: "a fox" });

      assert.equal(image.data.toString(), "PIXELS");
      assert.equal(image.provider, "openai-codex");
      assert.equal(image.outputFormat, "png");
      assert.equal(calls.length, 1);
      assert.match(calls[0]!.url, /backend-api\/codex\/responses/);
    });

    it("explains a refusal using the model's own words", async () => {
      const { impl } = recorder([
        sseResponse([
          { type: "response.output_text.delta", delta: "I won't depict that." },
          { type: "response.completed", response: { id: "r1" } },
        ]),
      ]);
      const client = new CodexImageClient({
        transport: { kind: "subscription", token: TOKEN },
        fetchImpl: impl,
      });

      await assert.rejects(client.generate({ prompt: "something refused" }), (err: unknown) => {
        assert.equal((err as CodexImageError).code, "NO_IMAGE");
        assert.match((err as CodexImageError).detail, /I won't depict that\./);
        return true;
      });
    });

    it("names re-login when the token has expired", async () => {
      const { impl } = recorder([new Response("token expired", { status: 401 })]);
      const client = new CodexImageClient({
        transport: { kind: "subscription", token: TOKEN },
        fetchImpl: impl,
        sleep: noSleep,
      });

      await assert.rejects(client.generate({ prompt: "x" }), (err: unknown) => {
        assert.equal((err as CodexImageError).code, "NO_CREDENTIAL");
        assert.equal((err as CodexImageError).status, 401);
        return true;
      });
    });
  });

  describe("retry policy", () => {
    it("retries a 500 and succeeds", async () => {
      const { impl, calls } = recorder([
        new Response("bad gateway", { status: 502 }),
        sseResponse([imageEvent("SECOND")]),
      ]);
      const client = new CodexImageClient({
        transport: { kind: "subscription", token: TOKEN },
        fetchImpl: impl,
        sleep: noSleep,
      });

      const image = await client.generate({ prompt: "x" });
      assert.equal(image.data.toString(), "SECOND");
      assert.equal(calls.length, 2);
    });

    it("does not retry a moderation refusal", async () => {
      // Every retry of a refusal spends quota and returns the same refusal.
      const { impl, calls } = recorder([
        () => new Response(JSON.stringify({ error: "moderation blocked" }), { status: 400 }),
      ]);
      const client = new CodexImageClient({
        transport: { kind: "subscription", token: TOKEN },
        fetchImpl: impl,
        sleep: noSleep,
      });

      await assert.rejects(client.generate({ prompt: "x" }), (err: unknown) => {
        assert.equal((err as CodexImageError).code, "MODERATION");
        return true;
      });
      assert.equal(calls.length, 1, "a refusal must not be retried");
    });

    it("does not retry a bad credential", async () => {
      const { impl, calls } = recorder([() => new Response("nope", { status: 401 })]);
      const client = new CodexImageClient({
        transport: { kind: "subscription", token: TOKEN },
        fetchImpl: impl,
        sleep: noSleep,
      });

      await assert.rejects(client.generate({ prompt: "x" }));
      assert.equal(calls.length, 1);
    });

    it("gives up after the configured number of retries", async () => {
      const { impl, calls } = recorder([() => new Response("upstream down", { status: 503 })]);
      const client = new CodexImageClient({
        transport: { kind: "subscription", token: TOKEN },
        fetchImpl: impl,
        sleep: noSleep,
        maxRetries: 2,
      });

      await assert.rejects(client.generate({ prompt: "x" }));
      assert.equal(calls.length, 3, "one attempt plus two retries");
    });

    it("stops once the deadline has passed", async () => {
      const { impl, calls } = recorder([() => new Response("down", { status: 503 })]);
      const client = new CodexImageClient({
        transport: { kind: "subscription", token: TOKEN },
        fetchImpl: impl,
        // Sleeping past the deadline must end the attempt loop, not extend it.
        sleep: async () => { await new Promise((r) => setTimeout(r, 30)); },
        timeoutMs: 20,
        maxRetries: 10,
      });

      await assert.rejects(client.generate({ prompt: "x" }), (err: unknown) => {
        assert.equal((err as CodexImageError).code, "ABORTED");
        return true;
      });
      assert.ok(calls.length < 10, `expected the deadline to stop retrying, got ${calls.length} calls`);
    });
  });

  describe("api transport", () => {
    it("posts JSON to generations and decodes b64_json", async () => {
      const { impl, calls } = recorder([
        new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("APIIMG").toString("base64") }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ]);
      const client = new CodexImageClient({
        transport: { kind: "api", apiKey: "sk-test" },
        fetchImpl: impl,
      });

      const image = await client.generate({ prompt: "a fox", size: "1536x1024" });

      assert.equal(image.data.toString(), "APIIMG");
      assert.equal(image.provider, "openai-api");
      assert.equal(image.model, "gpt-image-2");
      assert.match(calls[0]!.url, /\/v1\/images\/generations$/);
      assert.match(String(calls[0]!.init.body), /"size":"1536x1024"/);
    });

    it("switches to the edits endpoint when references are supplied", async () => {
      const { impl, calls } = recorder([
        new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("EDITED").toString("base64") }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ]);
      const client = new CodexImageClient({
        transport: { kind: "api", apiKey: "sk-test" },
        fetchImpl: impl,
      });

      const image = await client.generate({
        prompt: "make it night",
        inputImages: [{ data: Buffer.from("PNG"), mimeType: "image/png" }],
      });

      assert.equal(image.data.toString(), "EDITED");
      assert.match(calls[0]!.url, /\/v1\/images\/edits$/);
      assert.ok(calls[0]!.init.body instanceof FormData, "edits must be multipart");
    });

    it("never falls back from the subscription onto metered credits", async () => {
      // Silently moving a batch onto API billing is not ours to decide.
      const { impl, calls } = recorder([() => new Response("gone", { status: 503 })]);
      const client = new CodexImageClient({
        transport: { kind: "subscription", token: TOKEN },
        fetchImpl: impl,
        sleep: noSleep,
        maxRetries: 1,
      });

      await assert.rejects(client.generate({ prompt: "x" }));
      for (const call of calls) {
        assert.match(call.url, /backend-api\/codex\/responses/, "must never reach api.openai.com");
      }
    });
  });

  it("rejects an empty prompt before spending a request", async () => {
    const { impl, calls } = recorder([sseResponse([imageEvent()])]);
    const client = new CodexImageClient({
      transport: { kind: "subscription", token: TOKEN },
      fetchImpl: impl,
    });

    await assert.rejects(client.generate({ prompt: "   " }));
    assert.equal(calls.length, 0);
  });
});
