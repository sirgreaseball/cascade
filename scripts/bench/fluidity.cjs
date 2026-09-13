// Playback smoothness: samples the timeline clock on every animation frame, first while following a
// live run, then while replaying the finished run, and reports how often the flood clock stood still
// and for how long. usage: node fluidity.cjs <playwrightDir> <url>
const [, , pwDir, url] = process.argv;
const { chromium } = require(pwDir);
const toSeconds = (text) => {
  const m = /T\+(?:(\d+):)?(\d+):(\d+)/.exec(text || '');
  return m ? (Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) : NaN;
};
const sample = (page, ms) =>
  page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const el = [...document.querySelectorAll('div')].find((d) => String(d.className).includes('text-[22px]') && /^T\+/.test(d.textContent));
        const out = [];
        const start = performance.now();
        const loop = (t) => {
          out.push([t, el ? el.textContent : '']);
          if (t - start < ms) requestAnimationFrame(loop);
          else resolve(out);
        };
        requestAnimationFrame(loop);
      }),
    ms,
  );
const report = (label, samples) => {
  const pts = samples.map(([t, s]) => [t, toSeconds(s)]).filter(([, v]) => Number.isFinite(v));
  let still = 0;
  let longest = 0;
  let run = 0;
  let runStart = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][1] === pts[i - 1][1]) {
      still++;
      if (run === 0) runStart = pts[i - 1][0];
      run++;
      longest = Math.max(longest, pts[i][0] - runStart);
    } else run = 0;
  }
  const span = pts.length > 1 ? pts[pts.length - 1][1] - pts[0][1] : 0;
  const fps = pts.length > 1 ? ((pts.length - 1) * 1000) / (pts[pts.length - 1][0] - pts[0][0]) : 0;
  console.log(`${label.padEnd(18)} ${fps.toFixed(0)} fps · clock advanced ${span} s simulated · still on ${((still / Math.max(1, pts.length - 1)) * 100).toFixed(0)}% of frames · longest stall ${longest.toFixed(0)} ms`);
};
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.getByRole('button', { name: 'Run simulation' }).first().waitFor({ timeout: 240000 });
  await page.waitForTimeout(10000);
  await page.getByRole('button', { name: 'Run simulation' }).first().click();
  await page.waitForTimeout(6000);
  report('following live', await sample(page, 12000));
  // Wait for both engines to finish, then replay from the start at 1 min/s (a clock tick per second
  // simulated, so a stall shows up as an unchanged reading).
  await page.waitForFunction(() => !document.body.innerText.includes('Live'), null, { timeout: 1500000, polling: 2000 });
  await page.getByRole('radio', { name: '1 min/s' }).first().click().catch(() => undefined);
  await page.getByRole('button', { name: 'Play' }).first().click();
  await page.waitForTimeout(1500);
  report('replaying 1 min/s', await sample(page, 10000));
  await browser.close();
})().catch((e) => { console.error('FLUIDITY FAILED', e.message); process.exit(1); });
