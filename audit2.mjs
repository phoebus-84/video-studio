import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(String(e)));
const badResp = [];
page.on('response', r => { if (r.status() >= 400) badResp.push(`${r.status()} ${r.request().method()} ${r.url()}`); });

await page.goto('http://localhost:5199', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

// Expand via disclosure caret
const caret = page.locator('button, [role="button"]').filter({ hasText: /^$/ }).first();
// try clicking the actual triangle before "Childrens"
await page.locator('text=Childrens').first().click();
await page.waitForTimeout(500);
// click again or find caret sibling
const seriesVisible = await page.getByText('Fairy Tales', { exact: false }).or(page.getByText('fairy-tales')).count();
console.log('series visible after channel click:', seriesVisible);
if (!seriesVisible) {
  // try double click or caret
  const cs = await page.locator('[class*="caret"], [class*="chevron"], [class*="disclosure"], [class*="toggle"]').count();
  console.log('caret-ish elements:', cs);
  const btns = await page.locator('aside button, nav button, [class*="rail"] button').allInnerTexts();
  console.log('nav buttons:', JSON.stringify(btns.slice(0, 20)));
  // click first caret
  const c = page.locator('[class*="caret"], [class*="chevron"], [class*="toggle"]').first();
  if (await c.count()) { await c.click(); await page.waitForTimeout(500); }
}
await page.screenshot({ path: '/tmp/audit2-01-expanded.png' });
const navText = await page.locator('aside, nav, [class*="rail"]').first().innerText().catch(()=>'?');
console.log('NAV TEXT:', navText.replace(/\n/g, ' | '));

// find little-red and click
const lr = page.getByText(/little.red/i).first();
if (await lr.count()) {
  await lr.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/audit2-02-episode.png' });
  console.log('EPISODE OPENED');
  // list all tab-like elements
  const tabs = await page.locator('[role="tab"], [class*="tab"]').allInnerTexts();
  console.log('tabs found:', JSON.stringify(tabs));
} else {
  console.log('little-red still not visible; full body:');
  console.log((await page.locator('body').innerText()).slice(0, 800));
}

console.log('\nCONSOLE ERRORS:', consoleErrors.length);
consoleErrors.slice(0,10).forEach(e=>console.log('  ', e.slice(0,150)));
console.log('BAD RESPONSES:', badResp.length);
[...new Set(badResp)].slice(0,10).forEach(e=>console.log('  ', e));
await browser.close();
