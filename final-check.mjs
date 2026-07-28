import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("http://localhost:5199", { waitUntil: "networkidle", timeout: 15000 });
await p.waitForTimeout(2000);

// Expand Childrens
await p.locator(".channel-chevron-btn").first().click();
await p.waitForTimeout(600);

const text1 = await p.evaluate(() => document.body.innerText);
console.log("Library:", text1.split('\n').slice(1, 15).join(' | '));

// Click Little Red
await p.locator("button.episode-row").first().click();
await p.waitForTimeout(4000);

const storyboard = p.locator("[aria-label='Scene storyboard']");
const sbText = await storyboard.textContent();
const rows = await storyboard.locator("tbody tr").count();

console.log(`\nStoryboard rows: ${rows}`);
console.log(`Header: "${sbText.split('\n')[0]}"`);
console.log(`Has 'Little Red': ${sbText.includes("Little Red")}`);
console.log(`Has 'The Wolf': ${sbText.includes("Wolf")}`);
console.log(`Has 'brief/compose': ${sbText.includes("brief") || sbText.includes("compose")}`);

await p.screenshot({ path: "/tmp/final-state.png" });
await b.close();
