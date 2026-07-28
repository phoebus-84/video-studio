import { FalClient } from "./src/client.js";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, "..", "library", "explainers", "how-things-work", "gpu-architecture");
const EPISODE_PATH = join(BASE, "artifacts", "episode.json");
const IMG_DIR = join(BASE, "assets", "images");

if (!existsSync(IMG_DIR)) mkdirSync(IMG_DIR, { recursive: true });

// Read FAL_KEY from gateway config or env
let apiKey = process.env.FAL_KEY;
if (!apiKey) {
  try {
    const cfg = JSON.parse(readFileSync("/tmp/gateway-config.json", "utf-8"));
    apiKey = cfg.falKey || cfg.FAL_KEY;
  } catch {}
}
if (!apiKey) {
  console.error("❌ No FAL_KEY found. Set FAL_KEY environment variable.");
  process.exit(1);
}

const scenes = JSON.parse(readFileSync(EPISODE_PATH, "utf-8"));
const client = new FalClient({ apiKey });

console.log(`Generating ${scenes.length} images via nano-banana-pro...\n`);

for (const scene of scenes) {
  const id = scene.id;
  const outPath = join(IMG_DIR, `${id}.jpg`);
  
  if (existsSync(outPath)) {
    const stat = await import("node:fs/promises").then(fs => fs.stat(outPath));
    if (stat.size > 1000) {
      console.log(`  s${id.replace("s", "")} ⏭️  already exists (${stat.size} bytes)`);
      continue;
    }
  }

  console.log(`  s${id.replace("s", "")} 🎨 generating...`);
  
  try {
    // Client handles async polling + result fetching internally
    const job = await client.submitAndWait({
      profile: "fal-ai/nano-banana-pro@v1",
      params: {
        prompt: scene.intent,
        aspect_ratio: "16:9",
        resolution: "1K",
        output_format: "jpeg",
      },
    }, 2000, 300_000);

    // Extract the first image URL from the job
    const imageUrl = job.images?.[0]?.url;
    if (imageUrl) {
      const img = await client.download(imageUrl);
      writeFileSync(outPath, img.data);
      console.log(`  s${id.replace("s", "")} ✅ ${img.contentLength} bytes`);
    } else if (job.resultUrl) {
      // Fallback: download from result URL
      const img = await client.download(job.resultUrl);
      writeFileSync(outPath, img.data);
      console.log(`  s${id.replace("s", "")} ✅ ${img.contentLength} bytes (via resultUrl)`);
    } else {
      console.log(`  s${id.replace("s", "")} ❌ no image URL (status: ${job.status})`);
    }
  } catch (err: any) {
    console.log(`  s${id.replace("s", "")} ❌ ${err.message}`);
  }
  
  await new Promise(r => setTimeout(r, 2000));
}

console.log("\n✅ Done!");
