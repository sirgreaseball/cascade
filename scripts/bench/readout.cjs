// Section 1 check: the Model tab's "This device" readout names the map GPU and solver backend,
// shows frame stats, reports solver speed after a run, and copies a report.
// usage: node readout.cjs <playwrightDir> <url>
const [, , pwDir, url] = process.argv;
const { chromium } = require(pwDir);
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 200)));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.getByRole('button', { name: 'Run simulation' }).first().waitFor({ timeout: 240000 });
  await page.waitForTimeout(6000);
  await page.getByRole('radio', { name: 'Model' }).first().click();
  await page.waitForTimeout(1500);
  await page.getByText('This device', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  const readText = () => page.evaluate(() => {
    const title = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim() === 'This device');
    let el = title;
    while (el && !(el.innerText || '').includes('Copy performance report')) el = el.parentElement;
    return el ? el.innerText : 'section not found';
  });
  console.log('--- before run ---\n' + (await readText()));
  await page.getByRole('button', { name: 'Run simulation' }).first().click();
  await page.getByText(/Finished in/).first().waitFor({ timeout: 400000 });
  await page.waitForTimeout(2500);
  await page.getByText('This device', { exact: true }).first().scrollIntoViewIfNeeded();
  console.log('--- after grid run ---\n' + (await readText()));
  await page.getByRole('button', { name: 'Copy performance report' }).click();
  await page.waitForTimeout(600);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => 'clipboard read failed: ' + e.message);
  console.log('--- copied report ---\n' + clip);
  await page.screenshot({ path: 'readout.png', clip: { x: 0, y: 60, width: 460, height: 940 } });
  console.log('console errors: ' + errors.length);
  for (const e of errors.slice(0, 8)) console.log('   ' + e);
  await browser.close();
})().catch((e) => {
  console.error('CHECK FAILED', e.message);
  process.exit(1);
});
