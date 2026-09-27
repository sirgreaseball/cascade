// Solver speed on this machine: the grid solver alone (SPH off) offered the graphics card, then
// held to the processor, read from the Model tab's device readout.
// usage: node gpubench.cjs <playwrightDir> <url>
//
// The switch only *offers* the graphics card. Since the solvers are raced over the opening slice
// (57418b2), asking for the GPU and getting it are different things, so every run here reports the
// backend that actually ran and says so when it is not the one that was asked for. A timing printed
// against the wrong backend is worse than no timing at all.
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
  // "Finished in" appears before the run state clears, and the settings switches stay disabled
  // until it does — so wait for the switch itself rather than for the text, or for a fixed pause.
  const enabled = (name) => page.locator(`[role=switch][aria-label="${name}"]:not([disabled])`).first();
  const GPU_SWITCH = 'Let the grid solver try the graphics card';
  await enabled('SPH solver').waitFor({ timeout: 240000 });
  await enabled('SPH solver').click();
  await page.waitForTimeout(500);
  const run = async (asked, button) => {
    const t0 = Date.now();
    await page.getByRole('button', { name: button }).first().click();
    await page.getByText(/Finished in/).first().waitFor({ timeout: 1500000 });
    const wall = ((Date.now() - t0) / 1000).toFixed(1);
    await page.waitForTimeout(1500);
    await page.getByText('This device', { exact: true }).first().scrollIntoViewIfNeeded();
    const line = await readout(page);
    const ran = /Grid solver[^|]*Graphics card/.test(line) ? 'GPU' : /Grid solver[^|]*Processor/.test(line) ? 'CPU' : 'unknown';
    console.log(`asked for ${asked}, ran on ${ran}: finished after ${wall} s of wall time`);
    if (ran !== asked) console.log(`   ** that timing is the ${ran}, not the ${asked} — the race rejected the graphics card **`);
    console.log('   ' + line);
  };
  await run('GPU', 'Run simulation');
  await enabled(GPU_SWITCH).waitFor({ timeout: 600000 });
  await enabled(GPU_SWITCH).click();
  await page.waitForTimeout(600);
  await run('CPU', 'Run again with the current settings');
  console.log('console errors: ' + errors.length);
  for (const e of errors.slice(0, 6)) console.log('   ' + e);
  await browser.close();
})().catch((e) => { console.error('BENCH FAILED', e.message); process.exit(1); });
