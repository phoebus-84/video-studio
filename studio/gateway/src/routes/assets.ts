// ── Asset attempts and selection ────────────────────────────────────────────
//
// "Selected Asset" is a core term in the domain language — *the asset attempt
// currently chosen to fulfil a production role* — and the asset schema has
// carried a `selected` flag all along. But nothing could change it: the studio
// set `attempt.selected` on a local object and never told anyone, so choosing a
// different take survived exactly until the page reloaded.
//
// Selection is a property of a role, not of an attempt: choosing one attempt
// deselects its siblings in the same group, and never touches the others.
// Attempts themselves are immutable (ADR-0021); this only moves a pointer.
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { episodePath } from "@studio/contracts/src/layout.mjs";

interface AssetAttempt {
  id: string;
  sceneId: string;
  kind: string;
  state: string;
  filePath: string;
  selected?: boolean;
  [key: string]: unknown;
}

interface AssetGroup {
  sceneId: string;
  sceneTitle: string;
  attempts: AssetAttempt[];
}

interface AssetManifest {
  assets: AssetGroup[];
  updatedAt?: string;
  [key: string]: unknown;
}

const MANIFEST = path.join("assets", "manifest.json");

const fail = (reply: FastifyReply, status: number, error: string, message: string) =>
  reply.status(status).send({ error, message, correlationId: randomUUID() });

function manifestPath(root: string, p: { channel: string; series: string; episode: string }): string {
  return path.join(episodePath(root, p.channel, p.series, p.episode), MANIFEST);
}

async function readManifest(file: string): Promise<AssetManifest | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf-8"));
    if (!parsed || !Array.isArray(parsed.assets)) return null;
    return parsed as AssetManifest;
  } catch {
    return null;
  }
}

/**
 * Write the manifest atomically.
 *
 * A torn write here would lose the record of every generated asset and its
 * provenance, so the new content lands in a temporary file and is renamed over
 * the old one.
 */
async function writeManifest(file: string, manifest: AssetManifest): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2) + "\n");
  await fs.rename(tmp, file);
}

export function registerAssetRoutes(app: FastifyInstance, root: string): void {
  const prefix = "/api/channels/:channel/series/:series/episodes/:episode";

  // ── List attempts, grouped by production role ─────────────────────────
  app.get(`${prefix}/assets`, {
    schema: {
      description: "List asset attempts for an episode, grouped by scene.",
      tags: ["assets"],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { channel: string; series: string; episode: string };
    const manifest = await readManifest(manifestPath(root, params));

    if (!manifest) {
      // No manifest yet is normal for an episode that has generated nothing.
      return reply.send({ assets: [], updatedAt: null });
    }
    return reply.send(manifest);
  });

  // ── Choose which attempt fulfils a role ───────────────────────────────
  app.post(`${prefix}/assets/select`, {
    schema: {
      description: "Choose the attempt that fulfils a scene's production role.",
      tags: ["assets"],
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { channel: string; series: string; episode: string };
    const body = request.body as { attemptId?: string };
    if (!body?.attemptId) return fail(reply, 400, "BAD_REQUEST", "attemptId is required");

    const file = manifestPath(root, params);
    const manifest = await readManifest(file);
    if (!manifest) {
      return fail(reply, 404, "NOT_FOUND", "No asset manifest for this episode");
    }

    const group = manifest.assets.find((g) =>
      g.attempts?.some((a) => a.id === body.attemptId),
    );
    if (!group) {
      return fail(reply, 404, "NOT_FOUND", `No attempt with id ${body.attemptId}`);
    }

    const chosen = group.attempts.find((a) => a.id === body.attemptId)!;
    if (chosen.state !== "ready") {
      // Selecting a failed or pending attempt would put a broken asset into the
      // timeline, which the render would only discover much later.
      return fail(
        reply,
        409,
        "CONFLICT",
        `Attempt ${chosen.id} is "${chosen.state}"; only a ready attempt can be selected`,
      );
    }

    // Selection belongs to the role: exactly one attempt in this group is
    // selected, and no other group is touched.
    for (const attempt of group.attempts) {
      attempt.selected = attempt.id === body.attemptId;
    }
    manifest.updatedAt = new Date().toISOString();

    await writeManifest(file, manifest);

    return reply.send({
      sceneId: group.sceneId,
      selected: body.attemptId,
      deselected: group.attempts.filter((a) => a.id !== body.attemptId).map((a) => a.id),
    });
  });
}
