import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(String(e)));
const badResp = [];
page.on('response', r => { if (r.status() >= 400) badResp.push(`${r.status()} ${r.request().method()} ${r.url()}`); });

await page.goto('http://localhost:5199', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
// Expand via carets (channel label click does NOT expand — finding!)
await page.locator('button', { hasText: '▸' }).first().click();
await page.waitForTimeout(600);
// expand series caret if needed
const lrVisible = await page.getByText(/little red/i).count();
if (!lrVisible) { await page.locator('button', { hasText: '▸' }).first().click(); await page.waitForTimeout(600); }
await page.getByText(/little red/i).first().click();
await page.waitForTimeout(2000);

// 1. Click scene 1 row → assets inspector
await page.locator('tr, [class*="scene-row"], [class*="row"]').filter({ hasText: "Little Red's Task" }).first().click();
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/audit3-01-scene-selected.png' });
const inspector = await page.locator('[class*="inspector"], aside').last().innerText().catch(()=>'?');
console.log('=== INSPECTOR (scene selected):', inspector.slice(0, 500).replace(/\n+/g,' | '));

// 2. Narration tab
await page.getByRole('tab', { name: 'Narration' }).or(page.locator('[class*="tab"]', { hasText: 'Narration' })).first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/audit3-02-narration.png' });
const narr = await page.locator('main, [class*="canvas"]').first().innerText().catch(()=>'?');
console.log('\n=== NARRATION TAB:', narr.slice(0, 600).replace(/\n+/g,' | '));

// 3. Render tab
await page.getByRole('tab', { name: 'Render' }).or(page.locator('[class*="tab"]', { hasText: 'Render' })).first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: '/tmp/audit3-03-render.png' });
const rend = await page.locator('main, [class*="canvas"]').first().innerText().catch(()=>'?');
console.log('\n=== RENDER TAB:', rend.slice(0, 600).replace(/\n+/g,' | '));
const video = await page.locator('video').count();
console.log('video elements:', video);
if (video) {
  const src = await page.locator('video').first().getAttribute('src');
  console.log('video src:', src);
}

// 4. Status tab (inspector)
await page.getByRole('tab', { name: 'Status' }).first().click();
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/audit3-04-status.png' });
const status = await page.locator('[class*="inspector"], aside').last().innerText().catch(()=>'?');
console.log('\n=== STATUS TAB:', status.slice(0, 800).replace(/\n+/g,' | '));

// 5. Reviews tab
await page.getByRole('tab', { name: 'Reviews' }).first().click();
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/audit3-05-reviews.png' });
const rev = await page.locator('[class*="inspector"], aside').last().innerText().catch(()=>'?');
console.log('\n=== REVIEWS TAB:', rev.slice(0, 600).replace(/\n+/g,' | '));

// 6. Look for version/revision info anywhere
const all = await page.locator('body').innerText();
const verMatches = all.match(/.{0,30}(revision|version|sha256|hash|v\d+\.\d+).{0,30}/gi);
console.log('\n=== VERSION MENTIONS:', verMatches ? JSON.stringify(verMatches.slice(0,8)) : 'NONE');

// 7. Header content
const header = await page.locator('header').first().innerText().catch(()=>'?');
console.log('\n=== HEADER:', header.replace(/\n+/g,' | '));

console.log('\nCONSOLE ERRORS:', consoleErrors.length ? consoleErrors.slice(0,8) : 'none');
console.log('BAD RESPONSES:', badResp.length ? [...new Set(badResp)].slice(0,8) : 'none');
await browser.close();
