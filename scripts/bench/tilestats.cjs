// Loads the app, lets terrain stream in, pans a little, then prints the Model tab's device readout
// (including the terrain tile counters). usage: node tilestats.cjs <playwrightDir> <url>
const [, , pwDir, url] = process.argv;
const { chromium } = require(pwDir);
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const errors = [];
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && errors.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 200)));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByRole('button', { name: 'Run simulation' }).first().waitFor({ timeout: 180000 });
  await page.waitForTimeout(15000);
  await page.mouse.move(800, 500);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) { await page.mouse.move(800 - i * 20, 500); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForTimeout(8000);
  await page.getByRole('radio', { name: 'Model' }).first().click();
  await page.waitForTimeout(1000);
  await page.getByText('This device', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(2200);
  const readout = await page.evaluate(() => {
    const title = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim() === 'This device');
    let el = title;
    while (el && !(el.innerText || '').includes('Copy performance report')) el = el.parentElement;
    return el ? el.innerText : 'not found';
  });
  console.log(readout);
  console.log('console errors/warnings: ' + errors.length);
  for (const e of errors.slice(0, 10)) console.log('   ' + e);
  await browser.close();
})().catch((e) => { console.error('CHECK FAILED', e.message); process.exit(1); });
