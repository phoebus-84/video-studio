import { describe, expect, it, vi } from "vitest";
import { createHttp } from "../src/http.js";

describe("HTTP cancellation", () => {
  it("does not contact the provider or accounting endpoint when pre-aborted", async () => {
    const signal = AbortSignal.abort(), fetcher = vi.fn() as unknown as typeof fetch;
    const http = createHttp({ userAgent: "test", signal, fetch: fetcher });
    await expect(http.json("https://example.org/metadata")).rejects.toThrow();
    await expect(http.notify!("https://example.org/accounting", { method: "GET" })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("passes caller cancellation to an in-flight provider request", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const fetcher = vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }); started();
    })) as unknown as typeof fetch;
    const request = createHttp({ userAgent: "test", signal: controller.signal, fetch: fetcher }).json("https://example.org/metadata");
    const rejected = expect(request).rejects.toThrow();
    await ready; controller.abort(); await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("interrupts a thirty-second Retry-After wait instead of retrying a cancelled request", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => new Response("", { status: 429, headers: { "retry-after": "30" } })) as unknown as typeof fetch;
    const request = createHttp({ userAgent: "test", signal: controller.signal, fetch: fetcher }).json("https://example.org/rate-limited");
    const rejected = expect(request).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 25));
    controller.abort(); await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
  }, 1000);
});
