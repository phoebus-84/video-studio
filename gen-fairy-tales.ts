import { FalClient } from "./src/client.js";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = join(import.meta.dirname!, "..", "library", "childrens", "fairy-tales", "little-red");
const EPISODE_PATH = join(BASE, "artifacts", "episode.json");
const IMG_DIR = join(BASE, "assets", "images");
if (!existsSync(IMG_DIR)) mkdirSync(IMG_DIR, { recursive: true });

const apiKey = process.env.FAL_KEY;
if (!apiKey) { console.error("No FAL_KEY"); process.exit(1); }

const scenes = JSON.parse(readFileSync(EPISODE_PATH, "utf-8"));
const client = new FalClient({ apiKey });

console.log(`Generating ${scenes.length} images for Little Red Riding Hood...\n`);

for (const scene of scenes) {
  const id = scene.id;
  const outPath = join(IMG_DIR, `${id}.jpg`);
  
  if (existsSync(outPath)) {
    const { stat } = await import("node:fs/promises");
    const s = await stat(outPath);
    if (s.size > 1000) {
      console.log(`  ${id} ⏭️  ${s.size}B`);
      continue;
    }
  }

  console.log(`  ${id} 🎨 ${scene.title}...`);
  try {
    const job = await client.submitAndWait({
      profile: "fal-ai/nano-banana-pro@v1",
      params: {
        prompt: scene.intent,
        aspect_ratio: "16:9",
        resolution: "1K",
        output_format: "jpeg",
      },
    }, 2000, 300_000);

    const imageUrl = job.images?.[0]?.url;
    if (imageUrl) {
      const img = await client.download(imageUrl);
      writeFileSync(outPath, img.data);
      console.log(`  ${id} ✅ ${img.contentLength}B`);
    } else if (job.resultUrl) {
      const img = await client.download(job.resultUrl);
      writeFileSync(outPath, img.data);
      console.log(`  ${id} ✅ ${img.contentLength}B (fallback)`);
    } else {
      console.log(`  ${id} ❌ no URL (${job.status})`);
    }
  } catch (err: any) {
    console.log(`  ${id} ❌ ${err.message}`);
  }
  await new Promise(r => setTimeout(r, 3000));
}
console.log("\n✅ Done!");
