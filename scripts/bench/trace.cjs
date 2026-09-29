// Records a Chrome performance trace of the dashboard with the V8 sampler on, for slowframes.cjs.
//
// Use this, not a frame counter, to find out where a frame's time goes: it records every thread's
// work, sampled JavaScript on the main thread, and the frame boundaries. Tracing costs frames
// (roughly half the frame rate while it runs), so read proportions from it, never absolute fps.
//
// For JavaScript to have names, build once with `productionBrowserSourceMaps: true` in
// next.config.ts (then put it back — do not commit it), start `next start`, and trace against it.
//
// Phases: idle (nothing happening), pan (three drags), running (from 3 s after Run), late (from 18 s
// after Run, when the flood is large and new tiles have stopped arriving).
//
// usage: node trace.cjs <playwrightDir> <url> <label> <idle|pan|running|late> [seconds=8] [width=1600] [height=1000]
// writes <label>.trace.json in the current directory
const [, , pwDir, url, label = 'trace', phase = 'running', seconds = '8', w = '1600', h = '1000'] = process.argv;
const { chromium } = require(pwDir);
const fs = require('fs');

const CATEGORIES = [
  'toplevel',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'v8.execute',
  'blink.user_timing',
  'disabled-by-default-v8.cpu_profiler',
  'gpu',
  'viz',
  'cc',
];

(async () => {
  const args = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-unsafe-webgpu'];
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args });
  const page = await (await browser.newContext({ viewport: { width: Number(w), height: Number(h) } })).newPage();
  await page.addInitScript(() => {
    window.__frames = [];
    const loop = (t) => {
      window.__frames.push(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log(`${label}: renderer ${renderer}`);
  await page.getByRole('button', { name: 'Run simulation' }).first().waitFor({ timeout: 120000 });
  await page.waitForTimeout(8000);
  if (phase === 'running' || phase === 'late') {
    await page.getByRole('button', { name: 'Run simulation' }).first().click();
    await page.waitForTimeout(phase === 'late' ? 18000 : 3000);
  }
  const client = await page.context().newCDPSession(page);
  await client.send('Tracing.start', { transferMode: 'ReturnAsStream', traceConfig: { includedCategories: CATEGORIES, recordMode: 'recordAsMuchAsPossible' } });
  const t0 = await page.evaluate(() => performance.now());
  if (phase === 'pan') {
    const x0 = Number(w) * 0.55;
    const y0 = Number(h) * 0.5;
    for (let k = 0; k < 3; k++) {
      const dir = k % 2 ? -1 : 1;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x0 - dir * Number(w) * 0.16, y0 - dir * Number(h) * 0.08, { steps: 90 });
      await page.mouse.up();
    }
  } else {
    await page.waitForTimeout(Number(seconds) * 1000);
  }
  const fps = await page.evaluate((t0) => window.__frames.filter((t) => t >= t0).length / ((performance.now() - t0) / 1000), t0);
  const complete = new Promise((res) => client.once('Tracing.tracingComplete', res));
  await client.send('Tracing.end');
  const { stream } = await complete;
  const chunks = [];
  for (;;) {
    const { data, eof, base64Encoded } = await client.send('IO.read', { handle: stream, size: 1 << 20 });
    chunks.push(base64Encoded ? Buffer.from(data, 'base64').toString('utf8') : data);
    if (eof) break;
  }
  await client.send('IO.close', { handle: stream });
  fs.writeFileSync(`${label}.trace.json`, chunks.join(''));
  console.log(`${label}: ${fps.toFixed(1)} rAF fps while tracing (tracing itself costs frames); wrote ${label}.trace.json`);
  await browser.close();
})().catch((e) => {
  console.error('TRACE FAILED', e);
  process.exit(1);
});
