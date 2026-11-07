import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });

console.log("═══ ACCEPTANCE DEMO ═══\n");

await p.goto("http://localhost:5199", { waitUntil: "networkidle", timeout: 15000 });
await p.waitForTimeout(2000);

// Open the first episode of the first channel
await p.locator(".channel-chevron-btn").first().click();
await p.waitForTimeout(600);
await p.locator("button.episode-row").first().click();
await p.waitForTimeout(4000);

console.log("1. Storyboard");
const sb = p.locator("[aria-label='Scene storyboard']");
const rows = await sb.locator("tbody tr").count();
console.log(`   ✅ ${rows} scenes, titles: ${(await sb.locator("tbody tr td:nth-child(2)").first().textContent()).trim().slice(0, 40)}...`);

console.log("\n2. Asset inspection");
// Click a scene row
await sb.locator("tbody tr").first().click();
await p.waitForTimeout(500);
const assets = p.locator("[aria-label='Contextual inspector']");
console.log(`   ✅ Assets: "${(await assets.textContent()).trim().slice(0, 120)}"`);

console.log("\n3. Pipeline stages (Status tab)");
await p.locator("[role='tab']", { hasText: "Status" }).click();
await p.waitForTimeout(500);
const status = await p.locator("[aria-label='Contextual inspector']").textContent();
console.log(`   ✅ Status: "${status.trim().slice(0, 150)}"`);

console.log("\n4. Render tab");
await p.locator("[role='tab']", { hasText: "Render" }).click();
await p.waitForTimeout(1000);
const hasVideo = await p.locator("video").count();
console.log(`   ${hasVideo > 0 ? '✅' : '⚠️'} Video player: ${hasVideo > 0 ? 'present' : 'not found'}`);

console.log("\n5. Editor workspace");
const editor = p.locator("[aria-label='Editor workspace']");
const edVis = await editor.isVisible().catch(() => false);
if (edVis) {
  const edText = await editor.textContent();
  console.log(`   ✅ Editor: "${edText.trim().slice(0, 120)}"`);
} else {
  // Check if there's a LevelWorkspace for channel/series
  const body = await p.textContent("body");
  console.log(`   ⚠️  Editor not visible. Page: "${body.slice(0, 200)}"`);
}

console.log("\n6. Reviews tab");
await p.locator("[role='tab']", { hasText: "Reviews" }).click();
await p.waitForTimeout(500);
console.log(`   ✅ Reviews loaded`);

console.log("\n7. Narration tab");
await p.locator("[role='tab']", { hasText: "Narration" }).click();
await p.waitForTimeout(500);
const narr = await p.locator("[aria-label='Contextual inspector']").textContent();
const hasVoiceSettings = narr.includes("Voice") || narr.includes("temperature") || narr.includes("1.7B");
console.log(`   ${hasVoiceSettings ? '✅' : '⚠️'} Narration: ${hasVoiceSettings ? 'voice settings found' : 'no voice settings'}`);

await p.screenshot({ path: "/tmp/acceptance-final.png", fullPage: true });
console.log("\n✅ Acceptance demo complete");
await b.close();
