import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Capture ALL fetch responses
page.on('response', async (resp) => {
  if (resp.url().includes('little-red')) {
    try {
      const body = await resp.json();
      console.log('FETCH:', resp.url().split('/').pop());
      console.log('  scenes:', body.scenes?.length ?? 'none', 'stages:', body.stages?.length ?? 'none');
    } catch {}
  }
});

await page.goto("http://localhost:5199", { waitUntil: "networkidle", timeout: 15000 });
await page.waitForTimeout(2000);

await page.locator(".channel-chevron-btn").first().click();
await page.waitForTimeout(600);

console.log('\n--- Clicking Little Red ---');
await page.locator("button.episode-row").first().click();
await page.waitForTimeout(5000);

// Check what the episode store has
const epState = await page.evaluate(() => {
  // Access the module — won't work directly, use a workaround
  const body = document.body.innerText;
  return { text: body.slice(0, 500) };
});
console.log('\nPage text:', epState.text);

await browser.close();
