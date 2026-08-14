// ---------------------------------------------------------------------------
// Live fal integration test
// ---------------------------------------------------------------------------

import { FalClient } from "../src/client.js";

async function main() {
  const client = new FalClient({ apiKey: process.env.FAL_KEY! });

  console.log("Testing fal health...");
  const health = await client.health();
  console.log("Health:", JSON.stringify(health));

  if (!health.ok) {
    console.log("API key check failed, exiting");
    process.exit(1);
  }

  console.log("\nSubmitting a test image generation...");
  const job = await client.submitAndWait(
    {
      profile: "fal-ai/flux/dev@v1",
      params: {
        prompt: "A serene mountain lake at sunset, oil painting style, warm colors",
        image_size: "landscape_4_3",
      },
    },
    2000,
    300_000,
  );

  console.log("Job status:", job.status);
  console.log("Result URL:", job.resultUrl?.substring(0, 80) + "...");
  console.log("Timings:", JSON.stringify(job.timings));

  if (job.resultUrl) {
    console.log("\nDownloading image...");
    const img = await client.download(job.resultUrl);
    console.log("Downloaded:", img.contentLength, "bytes, type:", img.contentType);
  }

  console.log("\n✅ Fal integration works!");
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
