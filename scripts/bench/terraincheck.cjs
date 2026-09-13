// Section 2 check: fast erratic navigation (which cancels tile loads mid-flight), a deep zoom past
// the elevation data's last zoom, request outcomes, the terrain tile counters, and screenshots.
const [, , pwDir, url] = process.argv;
const { chromium } = require(pwDir);
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 220)));
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 220)));
  const tally = {};
  const kind = (u) => (/terrarium/.test(u) ? 'elevation' : /World_Imagery/.test(u) ? 'imagery' : null);
  const count = (k) => (tally[k] = (tally[k] || 0) + 1);
  page.on('response', (r) => { const k = kind(r.url()); if (k) count(`${k} ${r.status() < 400 ? 'ok' : 'http ' + r.status()}`); });
  page.on('requestfailed', (r) => { const k = kind(r.url()); if (k) count(`${k} ${/ABORT/i.test(r.failure()?.errorText || '') ? 'cancelled' : 'failed'}`); });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.getByRole('button', { name: 'Run simulation' }).first().waitFor({ timeout: 240000 });
  await page.waitForTimeout(15000);
  await page.screenshot({ path: 'terrain-before.png' });
  const drag = async (dx, dy) => {
    await page.mouse.move(800, 500);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(800 + (dx * i) / 10, 500 + (dy * i) / 10); await page.waitForTimeout(12); }
    await page.mouse.up();
    await page.waitForTimeout(120);
  };
  for (const [dx, dy] of [[-450, 0], [0, -320], [450, 0], [0, 320], [-320, -220], [320, 220], [-500, 60], [500, -60]]) await drag(dx, dy);
  await page.mouse.move(800, 500);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -320); await page.waitForTimeout(200); }
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 320); await page.waitForTimeout(200); }
  await page.waitForTimeout(20000);
  await page.screenshot({ path: 'terrain-after.png' });
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(1500); }
  await page.waitForTimeout(16000);
  await page.screenshot({ path: 'terrain-deep.png' });
  await page.getByRole('radio', { name: 'Model' }).first().click();
  await page.waitForTimeout(1200);
  await page.getByText('This device', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  const readout = await page.evaluate(() => {
    const title = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim() === 'This device');
    let el = title;
    while (el && !(el.innerText || '').includes('Copy performance report')) el = el.parentElement;
    return el ? el.innerText : 'not found';
  });
  console.log('--- readout ---\n' + readout);
  console.log('--- tile requests ---');
  for (const [k, v] of Object.entries(tally).sort()) console.log('  ' + k.padEnd(26) + v);
  console.log('console errors: ' + errors.length);
  for (const e of errors.slice(0, 10)) console.log('   ' + e);
  await browser.close();
})().catch((e) => { console.error('CHECK FAILED', e.message); process.exit(1); });
