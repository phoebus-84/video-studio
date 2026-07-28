import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:5199", { waitUntil: "networkidle", timeout: 15000 });
await page.waitForTimeout(2000);

// Expand to Little Red
await page.locator(".channel-chevron-btn").first().click();
await page.waitForTimeout(600);
await page.locator("button.episode-row").first().click();
await page.waitForTimeout(4000);

// Check storyboard
const storyboard = await page.locator("[aria-label='Scene storyboard']");
const text = await storyboard.textContent();
const hasSceneNames = text.includes("Little Red's Task") || text.includes("Into the Forest") || text.includes("Wolf");

console.log(`Storyboard shows scenes: ${hasSceneNames ? "✅ YES" : "❌ NO"}`);
console.log(`Storyboard content: "${text.trim().slice(0, 200)}"`);

// Check scene count in header
const headerText = text.split('\n')[0] || '';
console.log(`Header: "${headerText}"`);

// Count table rows
const rows = await storyboard.locator("tbody tr").count();
console.log(`Scene rows: ${rows}`);

await page.screenshot({ path: "/tmp/storyboard-fix.png" });
await browser.close();
