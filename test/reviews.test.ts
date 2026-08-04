import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerReviewRoutes } from "../src/routes/reviews.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeApp() {
  const root = await mkdtemp(join(tmpdir(), "gw-reviews-"));
  roots.push(root);
  const app = Fastify();
  registerReviewRoutes(app, { root });
  await app.ready();
  return { app, root };
}

describe("review routes", () => {
  it("persists an initial operator message when a thread is created with a body", async () => {
    const { app, root } = await makeApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/channels/childrens/series/fairy-tales/episodes/the-wolf-and-the-seven-little-kids/reviews",
      payload: {
        anchor: "render/render-002.mp4",
        body: "The wolf's eyes read as too scary for the target age.",
      },
    });
    expect(res.statusCode).toBe(201);
    const thread = res.json();
    expect(thread.anchor).toBe("render/render-002.mp4");
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]!.author).toBe("operator");
    expect(thread.messages[0]!.body).toBe("The wolf's eyes read as too scary for the target age.");
    expect(thread.messages[0]!.status).toBe("open");

    const disk = JSON.parse(
      await readFile(
        join(root, "childrens", "fairy-tales", "the-wolf-and-the-seven-little-kids", "reviews", `${thread.id}.json`),
        "utf-8",
      ),
    );
    expect(disk.messages).toHaveLength(1);
    expect(disk.messages[0]!.body).toContain("too scary");

    await app.close();
  });

  it("creates an empty thread when no body is supplied", async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/channels/wordless-comedy/series/give-me-time/episodes/the-run-up/reviews",
      payload: { anchor: "render/current" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().messages).toEqual([]);
    await app.close();
  });
});
