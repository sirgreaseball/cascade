// Runs Bhakra (Standard, grid solver only) on the GPU, then on the CPU, and compares.
// usage: node gpucompare.cjs <playwrightDir> <outDir> [resolution]
const path = require('path');
const fs = require('fs');
const [, , pwDir, outDir, resolution = 'Standard'] = process.argv;
const { chromium } = require(pwDir);
fs.mkdirSync(outDir, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const errors = [];
  page.on('console', (m) => (m.type() === 'error' || /WebGPU|cascade\]/.test(m.text())) && errors.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message.slice(0, 300)}`));
  const radio = async (name) => {
    const r = page.getByRole('radio', { name, exact: true });
    if (await r.count()) return r.first().click();
    return page.getByRole('button', { name, exact: true }).first().click();
  };
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByRole('button', { name: 'Run simulation' }).first().waitFor({ timeout: 180000 });
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: /Tehri Dam/ }).first().click();
  await page.waitForTimeout(600);
  await page.getByText('Bhakra Dam', { exact: true }).first().click();
  await page.waitForTimeout(8000);
  await radio('Model');
  await page.waitForTimeout(800);
  await radio(resolution);
  await page.getByRole('switch', { name: 'SPH solver' }).click();
  await page.waitForTimeout(400);

  const read = async (label) => {
    const txt = await page.locator('body').innerText();
    const pick = (re) => (txt.match(re) || [])[1] ?? '?';
    const row = {
      label,
      gridTime: pick(/Grid\s*(\d+(?:\.\d+)? (?:s|min)(?: \d+ s)?)/),
      where: pick(/(Graphics card \(WebGPU\)|Background worker|Main thread)/),
      people: pick(/People in flooded places\s*([\d.,]+K?)/),
      flooded: pick(/Flooded now\s*([\d.,]+ km²)/),
      first: pick(/first reached: ([^\n]+)/),
      lossOfLife: pick(/Estimated loss of life\s*([\d,<\s]+)/).trim(),
      mass: pick(/Mass balance, this run[\s\S]*?error ([\d.e+\-]+) %/),
    };
    console.log(JSON.stringify(row));
    await page.screenshot({ path: path.join(outDir, `${label}.png`) });
  };

  const runAndWait = async (label, button) => {
    const t0 = Date.now();
    await page.getByRole('button', { name: button }).first().click();
    while (Date.now() - t0 < 900000) {
      const txt = await page.locator('body').innerText();
      if (/Grid\s*\d+(?:\.\d+)? (s|min)/.test(txt)) break;
      if (/Grid\s*Error/.test(txt)) break;
      await page.waitForTimeout(2000);
    }
    log(label, 'grid finished after', Math.round((Date.now() - t0) / 1000), 's (browser clock)');
    await page.waitForTimeout(2500);
    await read(label);
  };

  await runAndWait(`gpu-${resolution}`, 'Run simulation');
  await page.getByRole('switch', { name: 'Run the grid solver on the graphics card' }).click();
  await page.waitForTimeout(600);
  await runAndWait(`cpu-${resolution}`, /Run again|run again/);
  fs.writeFileSync(path.join(outDir, 'console.txt'), errors.join('\n'));
  log('console messages:', errors.length);
  for (const e of errors.slice(0, 12)) console.log('  ', e);
  await browser.close();
})().catch((e) => {
  console.error('DRIVER FAILED', e);
  process.exit(1);
});
