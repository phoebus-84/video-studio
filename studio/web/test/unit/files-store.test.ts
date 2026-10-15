import { beforeEach, expect, test, vi } from "vitest";

/* The store asks the gateway for a level's files; here the gateway is a
   function that records what was asked and answers like the listing route. */
const requests: string[] = [];
let uiignoreSaved = false;

vi.mock("$lib/gateway.svelte.ts", () => ({
  getGatewayClient: () => ({
    fetchJSON: async (url: string, init?: { method?: string }) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "PUT") { uiignoreSaved = true; return { revision: "r2" }; }
      if (url.includes("/revisions")) return { revisions: [] };
      const showAll = url.includes("showIgnored=true");
      return {
        entries: [
          { name: "channel.md", path: "channel.md", kind: "file", size: 1, updatedAt: "", contentType: "text/markdown", presentation: null },
          ...(showAll
            ? [{ name: "bun.lock", path: "bun.lock", kind: "file", size: 1, updatedAt: "", contentType: null, presentation: null, ignored: true }]
            : []),
        ],
        ignored: uiignoreSaved ? 2 : 1,
      };
    },
  }),
}));

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

const { files, SHOW_IGNORED_STORAGE } = await import("$lib/files-store.svelte.ts");

const ref = { level: "channel" as const, channel: "acme" };

beforeEach(() => {
  requests.length = 0;
});

test("lists without what .uiignore leaves out, and keeps the count", async () => {
  await files.load(ref);
  expect(requests).toEqual(["GET /api/channels/acme/files?recursive=true"]);
  expect(files.entries.map((e) => e.path)).toEqual(["channel.md"]);
  expect(files.ignoredCount).toBe(1);
});

test("showing all files reloads with them, marked, and is remembered, keeping the open file", async () => {
  await files.load(ref);
  files.selectedPath = "channel.md";
  await files.setShowIgnored(true);
  expect(requests.at(-1)).toBe("GET /api/channels/acme/files?recursive=true&showIgnored=true");
  expect(files.selectedPath).toBe("channel.md");
  expect(files.entries.find((e) => e.path === "bun.lock")?.ignored).toBe(true);
  expect(store.get(SHOW_IGNORED_STORAGE)).toBe("true");

  await files.setShowIgnored(false);
  expect(requests.at(-1)).toBe("GET /api/channels/acme/files?recursive=true");
  expect(store.get(SHOW_IGNORED_STORAGE)).toBe("false");
});

test("saving a .uiignore refreshes the tree under its new rules", async () => {
  await files.load(ref);
  files.selectedPath = "series/s1/.uiignore";
  files.selectedContent = "drafts/\n";
  await files.save();
  expect(requests.at(-1)).toBe("GET /api/channels/acme/files?recursive=true");
  expect(files.ignoredCount).toBe(2);
  expect(files.selectedPath).toBe("series/s1/.uiignore");
});
