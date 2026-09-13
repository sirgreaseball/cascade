// Solver speed on this machine: the grid solver alone (SPH off) on the graphics card, then on the
// processor, read from the Model tab's device readout. usage: node gpubench.cjs <playwrightDir> <url>
const [, , pwDir, url] = process.argv;
const { chromium } = require(pwDir);
const readout = (page) =>
  page.evaluate(() => {
    const title = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim() === 'This device');
    let el = title;
    while (el && !(el.innerText || '').includes('Copy performance report')) el = el.parentElement;
    return el ? el.innerText.split('\n').filter((l) => /Grid solver|Graphics card|Processor|run|Frames/.test(l)).join(' | ') : 'readout not found';
  });
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.getByRole('button', { name: 'Run simulation' }).first().waitFor({ timeout: 240000 });
  await page.waitForTimeout(8000);
  await page.getByRole('radio', { name: 'Model', exact: true }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('switch', { name: 'SPH solver' }).click();
  await page.waitForTimeout(500);
  const run = async (label, button) => {
    const t0 = Date.now();
    await page.getByRole('button', { name: button }).first().click();
    await page.getByText(/Finished in/).first().waitFor({ timeout: 1500000 });
    const wall = ((Date.now() - t0) / 1000).toFixed(1);
    await page.waitForTimeout(1500);
    await page.getByText('This device', { exact: true }).first().scrollIntoViewIfNeeded();
    console.log(`${label}: finished after ${wall} s of wall time`);
    console.log('   ' + (await readout(page)));
  };
  await run('grid on GPU', 'Run simulation');
  await page.getByRole('switch', { name: 'Run the grid solver on the graphics card' }).click();
  await page.waitForTimeout(600);
  await run('grid on CPU', 'Run again with the current settings');
  console.log('console errors: ' + errors.length);
  for (const e of errors.slice(0, 6)) console.log('   ' + e);
  await browser.close();
})().catch((e) => { console.error('BENCH FAILED', e.message); process.exit(1); });
