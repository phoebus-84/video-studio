import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push(String(e)));
const badResp = [];
page.on('response', r => { if (r.status() >= 400) badResp.push(`${r.status()} ${r.request().method()} ${r.url()}`); });

await page.goto('http://localhost:5199', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.locator('button', { hasText: '▸' }).first().click();
await page.waitForTimeout(600);
if (!await page.getByText(/little red/i).count()) { await page.locator('button', { hasText: '▸' }).first().click(); await page.waitForTimeout(600); }
await page.getByText(/little red/i).first().click();
await page.waitForTimeout(2000);

// Precise tab clicks — use role=tab if present else last match
async function clickTab(name) {
  const t = page.getByRole('tab', { name, exact: true });
  if (await t.count()) { await t.last().click(); return true; }
  const b = page.locator('button', { hasText: name });
  if (await b.count()) { await b.last().click(); return true; }
  return false;
}

// NARRATION
await clickTab('Narration');
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/audit4-narration.png' });
const audioCt = await page.locator('audio').count();
console.log('=== NARRATION: audio elements:', audioCt);
const narrText = await page.locator('body').innerText();
console.log('has voice settings:', /voice|speed|pitch/i.test(narrText));
console.log('narration rows w/ duration:', (narrText.match(/\d+\.\d+s|\d+:\d\d/g) || []).slice(0,12));

// RENDER
await clickTab('Render');
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/audit4-render.png' });
const video = await page.locator('video').count();
console.log('\n=== RENDER: video elements:', video);
if (video) console.log('src:', await page.locator('video').first().getAttribute('src'));

// STAGE RAIL — click 'narration' stage chip
console.log('\n=== STAGE RAIL ===');
const railChips = await page.locator('[class*="stage"], [class*="rail"] button').allInnerTexts();
console.log('rail chips:', JSON.stringify(railChips.filter(t=>t.length<20).slice(0,15)));
const stageChip = page.locator('button', { hasText: 'script' }).first();
if (await stageChip.count()) {
  await stageChip.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '/tmp/audit4-stage-script.png' });
  const after = await page.locator('body').innerText();
  console.log('after clicking script stage, editor visible:', /monaco|textarea|editor/i.test(after));
  const textareas = await page.locator('textarea, [contenteditable="true"]').count();
  console.log('textareas/contenteditable:', textareas);
}

// STALENESS indicators
const stale = await page.locator('[class*="stale"]').count();
console.log('\nstale indicator elements:', stale);

// Run/execute buttons
const runBtns = await page.locator('button').filter({ hasText: /run|execute|rerun|regenerate/i }).allInnerTexts();
console.log('action buttons:', JSON.stringify([...new Set(runBtns)].slice(0,10)));

console.log('\nERRORS:', errs.length ? errs.slice(0,8) : 'none');
console.log('BAD:', badResp.length ? [...new Set(badResp)].slice(0,8) : 'none');
await browser.close();
