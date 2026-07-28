import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:5199", { waitUntil: "networkidle", timeout: 15000 });
await page.waitForTimeout(2000);

// Navigate to Little Red
await page.locator(".channel-chevron-btn").first().click();
await page.waitForTimeout(600);
await page.locator("button.episode-row").first().click();
await page.waitForTimeout(4000);

// Check storyboard content
const storyboard = page.locator("[aria-label='Scene storyboard']");
const text = await storyboard.textContent();

const hasRealScenes = text.includes("Little Red's Task") || text.includes("Into the Forest") || text.includes("Wolf");
const hasStagesAsScenes = text.includes("brief") && text.includes("script") && text.includes("compose");

console.log(`Real scenes: ${hasRealScenes ? "✅" : "❌"}`);
console.log(`Stages as scenes: ${hasStagesAsScenes ? "❌ BUG" : "✅ fixed"}`);
console.log(`Header: "${text.split('\n')[0]}"`);

// Count scene rows in table
const rows = await storyboard.locator("tbody tr").count();
console.log(`Scene rows: ${rows} (expect 8)`);

await page.screenshot({ path: "/tmp/storyboard-fixed.png" });
await browser.close();
