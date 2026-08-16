import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  applyEvent,
  buildHeaders,
  buildRequestBody,
  extractAccountId,
  parseSseStream,
  type ParsedResponse,
} from "../src/protocol.js";
import { CodexImageError } from "../src/errors.js";

/**
 * The subscription transport speaks an undocumented protocol, so these tests
 * are the specification: if the backend changes shape, this file is what says
 * what we believed it was.
 */
describe("codex protocol", () => {
  function jwt(payload: Record<string, unknown>): string {
    const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
  }

  function stream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
  }

  function sse(event: unknown): string {
    return `data: ${JSON.stringify(event)}\n\n`;
  }

  describe("extractAccountId", () => {
    it("reads the account id out of the auth claim", () => {
      const token = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-123" } });
      assert.equal(extractAccountId(token), "acct-123");
    });

    it("rejects a credential that is not a JWT, naming the fix", () => {
      assert.throws(
        () => extractAccountId("sk-proj-not-a-jwt"),
        (err: unknown) => {
          assert.ok(err instanceof CodexImageError);
          assert.equal(err.code, "BAD_CREDENTIAL");
          // An API key here is the common mistake, so the message must point
          // at logging in rather than at the token being malformed.
          assert.match(err.detail, /login/i);
          return true;
        },
      );
    });

    it("rejects a JWT carrying no ChatGPT account", () => {
      assert.throws(
        () => extractAccountId(jwt({ sub: "user" })),
        (err: unknown) => (err as CodexImageError).code === "BAD_CREDENTIAL",
      );
    });
  });

  describe("buildRequestBody", () => {
    it("asks for exactly one image and does not let the backend keep it", () => {
      const body = buildRequestBody({ prompt: "a fox", model: "gpt-5.5", outputFormat: "png" });

      assert.equal(body["store"], false, "a generated asset must not persist in a chat we do not control");
      assert.equal(body["parallel_tool_calls"], false);
      assert.deepEqual(body["tools"], [{ type: "image_generation", output_format: "png" }]);
    });

    it("carries reference images as data URLs on the user turn", () => {
      const body = buildRequestBody({
        prompt: "make it night",
        model: "gpt-5.5",
        outputFormat: "webp",
        inputImages: [{ data: Buffer.from("PNGDATA"), mimeType: "image/png" }],
      });

      const input = body["input"] as Array<{ content: Array<Record<string, string>> }>;
      const image = input[0]!.content[1]!;
      assert.equal(image["type"], "input_image");
      assert.equal(image["image_url"], `data:image/png;base64,${Buffer.from("PNGDATA").toString("base64")}`);
    });

    it("omits the cache key rather than sending an empty one", () => {
      assert.ok(!("prompt_cache_key" in buildRequestBody({ prompt: "x", model: "m", outputFormat: "png" })));
    });
  });

  describe("buildHeaders", () => {
    it("sends the account id alongside the bearer token", () => {
      const headers = buildHeaders("token-abc", "acct-1");
      assert.equal(headers["Authorization"], "Bearer token-abc");
      // The backend rejects the request without this, even though the same id
      // is already inside the token.
      assert.equal(headers["chatgpt-account-id"], "acct-1");
      assert.equal(headers["accept"], "text/event-stream");
    });
  });

  describe("applyEvent", () => {
    it("classifies a moderation refusal apart from a transport failure", () => {
      const parsed: ParsedResponse = { text: "" };
      assert.throws(
        () => applyEvent({ type: "error", message: "blocked by content policy" }, parsed),
        (err: unknown) => (err as CodexImageError).code === "MODERATION",
      );
    });

    it("classifies a quota failure so the caller can back off", () => {
      const parsed: ParsedResponse = { text: "" };
      assert.throws(
        () => applyEvent({ type: "error", message: "You have hit your rate limit" }, parsed),
        (err: unknown) => (err as CodexImageError).code === "RATE_LIMIT",
      );
    });

    it("fails an image call that completed with no data", () => {
      const parsed: ParsedResponse = { text: "" };
      assert.throws(
        () =>
          applyEvent(
            { type: "response.output_item.done", item: { type: "image_generation_call", result: "" } },
            parsed,
          ),
        (err: unknown) => (err as CodexImageError).code === "NO_IMAGE",
      );
    });
  });

  describe("parseSseStream", () => {
    it("collects the image, the revised prompt and the usage", async () => {
      const parsed = await parseSseStream(
        stream([
          sse({ type: "response.created", response: { id: "resp_1" } }),
          sse({
            type: "response.output_item.done",
            item: {
              type: "image_generation_call",
              id: "ig_1",
              status: "completed",
              result: Buffer.from("IMAGEBYTES").toString("base64"),
              revised_prompt: "a red fox, golden hour",
            },
          }),
          sse({
            type: "response.completed",
            response: { id: "resp_1", usage: { input_tokens: 12, output_tokens: 3400, total_tokens: 3412 } },
          }),
          "data: [DONE]\n\n",
        ]),
      );

      assert.equal(Buffer.from(parsed.image!.result, "base64").toString(), "IMAGEBYTES");
      assert.equal(parsed.image!.revisedPrompt, "a red fox, golden hour");
      assert.equal(parsed.responseId, "resp_1");
      assert.equal(parsed.usage?.totalTokens, 3412);
    });

    it("reassembles an event split across chunk boundaries", async () => {
      // A real stream splits wherever TCP decides to, which for a base64 image
      // is mid-payload. Losing that event means losing the image.
      const event = sse({
        type: "response.output_item.done",
        item: { type: "image_generation_call", result: Buffer.from("SPLIT").toString("base64") },
      });
      const cut = Math.floor(event.length / 2);

      const parsed = await parseSseStream(stream([event.slice(0, cut), event.slice(cut)]));
      assert.equal(Buffer.from(parsed.image!.result, "base64").toString(), "SPLIT");
    });

    it("keeps a final event that arrives without a trailing blank line", async () => {
      const parsed = await parseSseStream(
        stream([
          `data: ${JSON.stringify({
            type: "response.output_item.done",
            item: { type: "image_generation_call", result: Buffer.from("TAIL").toString("base64") },
          })}`,
        ]),
      );
      assert.equal(Buffer.from(parsed.image!.result, "base64").toString(), "TAIL");
    });

    it("keeps the prose when the model answers instead of drawing", async () => {
      const parsed = await parseSseStream(
        stream([
          sse({ type: "response.output_text.delta", delta: "I can't " }),
          sse({ type: "response.output_text.delta", delta: "draw that." }),
          sse({ type: "response.completed", response: { id: "resp_2" } }),
        ]),
      );

      assert.equal(parsed.image, undefined);
      // This text is the only explanation the caller ever gets.
      assert.equal(parsed.text, "I can't draw that.");
    });

    it("ignores a malformed frame rather than failing the generation", async () => {
      const parsed = await parseSseStream(
        stream([
          "data: {not json\n\n",
          sse({
            type: "response.output_item.done",
            item: { type: "image_generation_call", result: Buffer.from("OK").toString("base64") },
          }),
        ]),
      );
      assert.equal(Buffer.from(parsed.image!.result, "base64").toString(), "OK");
    });

    it("surfaces a mid-stream failure event", async () => {
      await assert.rejects(
        parseSseStream(stream([sse({ type: "response.failed", response: { error: { message: "upstream exploded" } } })])),
        (err: unknown) => {
          assert.equal((err as CodexImageError).code, "PROTOCOL");
          assert.match((err as CodexImageError).detail, /upstream exploded/);
          return true;
        },
      );
    });
  });
});
