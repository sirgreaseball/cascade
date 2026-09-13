// Section 3 check: the flood drawn on the GPU. Runs a simulation, screenshots the live flood,
// pauses and scrubs, steps through every map layer, switches to 2D, and reports console errors
// (shader compile failures surface there). usage: node floodcheck.cjs <playwrightDir> <url>
const [, , pwDir, url] = process.argv;
const { chromium } = require(pwDir);
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const errors = [];
  page.on('console', (m) => (m.type() === 'error' || /shader|GLSL|luma|binding/i.test(m.text())) && errors.push(`[${m.type()}] ${m.text().slice(0, 260)}`));
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.slice(0, 260)));
  const radio = (name) => page.getByRole('radio', { name, exact: true }).first().click();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.getByRole('button', { name: 'Run simulation' }).first().waitFor({ timeout: 240000 });
  await page.waitForTimeout(12000);
  await page.getByRole('button', { name: 'Run simulation' }).first().click();
  await page.waitForTimeout(30000);
  await page.screenshot({ path: 'flood-live.png' });
  // Pause, then scrub to 40% of the timeline.
  await page.getByRole('button', { name: 'Pause' }).first().click().catch(() => undefined);
  await page.waitForTimeout(800);
  const track = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) => d.className && String(d.className).includes('cursor-pointer') && d.querySelector('svg'));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width * 0.4, y: r.top + r.height / 2 };
  });
  if (track) { await page.mouse.click(track.x, track.y); await page.waitForTimeout(1500); }
  await page.screenshot({ path: 'flood-scrub.png' });
  for (const layer of ['Peak depth', 'Arrival', 'Hazard', 'Velocity']) {
    await radio(layer).catch(() => errors.push('could not select layer ' + layer));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `flood-${layer.replace(' ', '-').toLowerCase()}.png` });
  }
  await radio('Depth');
  await radio('2D');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'flood-2d.png' });
  console.log('scrubbed: ' + (track ? 'yes' : 'track not found'));
  console.log('console errors: ' + errors.length);
  for (const e of errors.slice(0, 12)) console.log('   ' + e);
  await browser.close();
})().catch((e) => { console.error('CHECK FAILED', e.message); process.exit(1); });
