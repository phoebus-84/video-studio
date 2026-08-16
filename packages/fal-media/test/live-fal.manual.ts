// ---------------------------------------------------------------------------
// Live fal integration script — NOT part of the test suite
// ---------------------------------------------------------------------------
// Hits the real fal.ai API and costs money, so it is deliberately named
// .manual.ts: vitest only collects test/**/*.test.ts. Run it by hand:
//
//   FAL_KEY=... npx tsx test/live-fal.manual.ts
//   FAL_KEY=... npx tsx test/live-fal.manual.ts minimax/h3/text-to-video@v1
// ---------------------------------------------------------------------------

import { createFalClient } from "../src/client.js";
import { getProfile, listProfiles } from "../src/profiles.js";

async function main() {
  const profileId = process.argv[2] ?? "fal-ai/flux/dev@v1";
  const profile = getProfile(profileId);

  if (!profile) {
    console.error(`Unknown profile: ${profileId}`);
    console.error(`Known:\n${listProfiles().map((p) => `  ${p.profileId}`).join("\n")}`);
    process.exit(2);
  }

  const client = createFalClient();

  const isVideo = profile.operation.endsWith("-to-video");
  const parameters: Record<string, unknown> = isVideo
    ? { prompt: "A serene mountain lake at sunset, slow drifting camera", duration: 5 }
    : {
        prompt: "A serene mountain lake at sunset, oil painting style, warm colors",
        image_size: "landscape_4_3",
      };

  console.log(`Submitting to ${profile.endpointId} (${profile.operation})…`);
  console.log(`Estimated cost: ${profile.pricing.estimatedUnitCost} ${profile.pricing.currency}`);

  const result = await client.submitAndWait({
    idempotencyKey: `manual-${Date.now()}`,
    binding: {
      endpointId: profile.endpointId,
      contractVersion: profile.contractVersion,
      baseUrl: "",
    },
    parameters,
    // Video takes minutes; this is the wall-clock budget for the whole wait.
    timeoutMs: isVideo ? 900_000 : 300_000,
  });

  console.log("\nStatus:", result.status);
  console.log("Request:", result.providerRequestId);
  console.log("Profile:", result.profileId, "@", result.schemaFingerprint.slice(0, 12));
  console.log("Cost:", result.cost ? `${result.cost.amount} ${result.cost.currency}` : "not reported");
  for (const output of result.outputs) {
    console.log(`Output: ${output.contentType} ${output.url}`);
  }
  console.log(`\nRecorded spend this run: ${client.totalSpendUsd} USD over ${client.submissionCount} generation(s)`);
}

main().catch((err) => {
  console.error("❌ Failed:", err instanceof Error ? err.message : String(err));
  if (err && typeof err === "object" && "details" in err) {
    console.error("Details:", JSON.stringify((err as { details: unknown }).details));
  }
  process.exit(1);
});
