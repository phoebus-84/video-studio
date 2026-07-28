import { chromium } from 'playwright';

const findings = [];
const note = (sev, area, msg) => { findings.push({sev, area, msg}); console.log(`[${sev}] ${area}: ${msg}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(String(e)));
const failedRequests = [];
page.on('requestfailed', r => failedRequests.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`));
page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.request().method()} ${r.url()}`); });

await page.goto('http://localhost:5199', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/audit-01-home.png' });

// ── 1. Library nav ──
const channels = await page.locator('[class*="channel"], [data-testid*="channel"]').count();
console.log(`\n=== HOME: channels visible: ${channels}`);
const bodyText = await page.locator('body').innerText();
if (!bodyText.includes('fairy-tales') && !bodyText.includes('Fairy')) note('WARN', 'library', 'fairy-tales series not visible on home');
if (bodyText.includes('gpu-architecture') || bodyText.includes('GPU')) console.log('gpu-architecture visible');

// ── 2. Navigate to episode ──
// Click channel then series then episode
const channelBtn = page.getByText('childrens', { exact: false }).first();
if (await channelBtn.count()) { await channelBtn.click(); await page.waitForTimeout(600); }
const epBtn = page.getByText('little-red', { exact: false }).first();
if (await epBtn.count()) { await epBtn.click(); await page.waitForTimeout(1500); }
else note('FAIL', 'nav', 'little-red episode not clickable from library nav');
await page.screenshot({ path: '/tmp/audit-02-episode.png' });

// ── 3. Tabs in SceneViewer ──
for (const tab of ['Storyboard', 'Narration', 'Render']) {
  const t = page.getByRole('tab', { name: tab }).or(page.getByRole('button', { name: tab }));
  if (await t.count() === 0) { note('FAIL', 'tabs', `${tab} tab missing`); continue; }
  await t.first().click(); await page.waitForTimeout(800);
  await page.screenshot({ path: `/tmp/audit-03-${tab.toLowerCase()}.png` });
  const txt = await page.locator('main, [class*="canvas"], [class*="viewer"]').first().innerText().catch(() => '');
  console.log(`\n=== TAB ${tab}: ${txt.slice(0, 200).replace(/\n+/g, ' | ')}`);
}

// ── 4. Inspector tabs ──
for (const tab of ['Assets', 'Reviews', 'Status']) {
  const t = page.getByRole('tab', { name: tab }).or(page.getByRole('button', { name: tab }));
  if (await t.count() === 0) { note('FAIL', 'inspector', `${tab} tab missing`); continue; }
  await t.first().click(); await page.waitForTimeout(800);
  await page.screenshot({ path: `/tmp/audit-04-${tab.toLowerCase()}.png` });
}

// ── 5. Check for file versions/revisions in UI ──
const fullText = await page.locator('body').innerText();
if (!/revision|version|sha|hash/i.test(fullText)) note('FAIL', 'versions', 'No file version/revision info visible anywhere in episode view');
else console.log('\nversion-ish text found:', fullText.match(/.{0,40}(revision|version|sha|hash).{0,40}/gi)?.slice(0,5));

// ── 6. Editor workspace ──
const editorBtn = page.getByRole('button', { name: /editor/i }).or(page.getByText('Editor', { exact: true }));
if (await editorBtn.count()) {
  await editorBtn.first().click(); await page.waitForTimeout(1200);
  await page.screenshot({ path: '/tmp/audit-05-editor.png' });
  const editorText = await page.locator('body').innerText();
  const hasFileTree = /narration-script|episode\.json|brief\.md/i.test(editorText);
  if (!hasFileTree) note('FAIL', 'editor', 'Editor mode does not show artifact files for the selected episode');
} else note('WARN', 'editor', 'No Editor mode toggle found in UI');

// ── 7. WS / live updates ──
// check connection state indicator
const hasOffline = await page.locator('[class*="offline"]').count();
console.log(`\noffline banner elements: ${hasOffline}`);

console.log('\n=== CONSOLE ERRORS ===');
consoleErrors.slice(0, 15).forEach(e => console.log('  ', e.slice(0, 200)));
console.log('=== FAILED REQUESTS ===');
[...new Set(failedRequests)].slice(0, 15).forEach(e => console.log('  ', e.slice(0, 200)));

console.log('\n=== FINDINGS ===');
findings.forEach(f => console.log(`[${f.sev}] ${f.area}: ${f.msg}`));

await browser.close();
