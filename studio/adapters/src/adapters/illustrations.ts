import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { StageAdapter } from "../descriptor.js";

/**
 * Adopts images already generated into `assets/images/` as the episode's
 * illustrations. It generates nothing: the images come from whoever produced
 * them — Pi through an image tool, or a person — and this only places them
 * where the `illustrations/` contract says they live.
 */
export const illustrationsFromAssets: StageAdapter = {
  id: "illustrations-from-assets",
  summary: "Adopts images already in assets/images/ as the episode's illustrations; generates none",
  capability: "image.generate",
  provider: "pre-generated-assets",
  produces: ["illustrations/"],
  consumes: [],
  requires: {},
  async perform(ctx) {
    const assetsDir = path.join(ctx.episodeDir, "assets", "images");
    const framesDir = path.join(ctx.episodeDir, "artifacts", "frames");
    const outputs: string[] = [];

    try {
      const files = await fs.readdir(assetsDir);
      const jpgs = files.filter((f) => f.endsWith(".jpg") || f.endsWith(".png"));
      for (const jpg of jpgs) {
        // Copy to frames directory (illustrations/ contract location)
        await fs.mkdir(framesDir, { recursive: true });
        const src = path.join(assetsDir, jpg);
        const dst = path.join(framesDir, jpg.replace(/\.jpg$/, ".png"));
        if (!(await exists(dst))) {
          await fs.copyFile(src, dst);
        }
        outputs.push(dst);
      }
      ctx.log(`  illustrations: ${jpgs.length} images ready`);
    } catch {
      ctx.log(`  illustrations: no images found (skipped)`);
    }
    return outputs;
  },
};

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
