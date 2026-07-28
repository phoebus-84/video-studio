import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push(String(e)));

await page.goto('http://localhost:5199', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

// Expand Childrens (click caret) then select little-red
await page.locator('button', { hasText: '▸' }).first().click();
await page.waitForTimeout(600);
// Click channel label — should also expand (vsw-s9f)
await page.getByText(/little red/i).first().click();
await page.waitForTimeout(2000);

const bodyText = await page.locator('body').innerText();

console.log('=== 1. Channel label expansion (vsw-s9f) ===');
console.log('voice settings visible:', /voice|speed|pitch/i.test(bodyText) ? '✓' : '✗');

console.log('\n=== 2. Storyboard data (vsw-mm9) ===');
const storyboard = await page.locator('[class*="storyboard"], table').first().innerText().catch(() => '?');
const hasNarration = /completed|✓|ready/.test(storyboard);
const hasRole = /narrator|girl|wolf|woodcutter/i.test(storyboard);
console.log('narration status:', hasNarration ? '✓ (has completed/ready)' : '✗');
console.log('role display:', hasRole ? '✓' : '✗');

console.log('\n=== 3. Status tab pipeline stages (vsw-e43) ===');
const statusTab = page.getByRole('tab', { name: 'Status' }).last();
if (await statusTab.count()) {
  await statusTab.click(); await page.waitForTimeout(800);
  const statText = await page.locator('[class*="inspector"], aside').last().innerText();
  const hasStages = /brief|script|art-direction|narration/.test(statText);
  console.log('pipeline stages:', hasStages ? '✓' : '✗');
  if (hasStages) {
    const stageLines = statText.match(/\b(brief|script|art-direction|narration|illustrations|captions|timing|compose|qa)\b\s+\w+/g);
    console.log('  stages found:', stageLines?.length ?? 0);
  }
} else console.log('Status tab: not found');

console.log('\n=== 4. Staleness (vsw-7aw) ===');
const staleEls = await page.locator('.stale, [class*="stale"]').count();
console.log('stale elements:', staleEls, staleEls > 0 ? '✓' : '✗');

console.log('\n=== 5. Stage click → editor (vsw-0b1) ===');
const scriptChip = page.locator('button', { hasText: 'script' }).first();
if (await scriptChip.count()) {
  await scriptChip.click(); await page.waitForTimeout(1200);
  const editorText = await page.locator('[class*="editor"]').first().innerText().catch(() => '');
  const hasEditor = /rev|save|discard/i.test(editorText);
  console.log('editor opened:', hasEditor ? '✓ (shows rev/save)' : '✗');
} else console.log('script chip: not found');

console.log('\n=== 6. File versions (vsw-kmf) ===');
const hasRevision = /rev\s+[a-f0-9]{7}/i.test(bodyText) || /revision/i.test(bodyText);
console.log('revision visible:', hasRevision ? '✓' : '✗ (may need stage clicked)');

console.log('\n=== 7. WebSocket (vsw-djq) ===');
// WS errors would show in console
const wsErrors = errs.filter(e => /ws|websocket|socket/i.test(e));
console.log('WS errors:', wsErrors.length, wsErrors.length === 0 ? '✓' : '✗');

console.log('\n=== 8. Reviews (vsw-362) ===');
const reviewsTab = page.getByRole('tab', { name: 'Reviews' }).last();
if (await reviewsTab.count()) {
  await reviewsTab.click(); await page.waitForTimeout(300);
  const revText = await page.locator('[class*="inspector"], aside').last().innerText();
  const emptyThreads = revText.includes('0 open') || revText.includes('No reviews');
  console.log('reviews clean:', emptyThreads ? '✓ (0 stale threads)' : '✗');
} else console.log('Reviews tab: not found');

console.log('\nERRORS:', errs.length ? errs.slice(0,5) : 'none');
await browser.close();
