// Performance probe: frames per second and main-thread blocking while the dashboard runs.
// usage: node perf.cjs <playwrightDir> <url> <label> <width> <height> <view: 3d|2d> <gpu: hw|sw> <blur: on|off>
const [, , pwDir, url, label = 'run', w = '1600', h = '1000', view = '3d', gpu = 'hw', blur = 'on', quick = ''] = process.argv;
const { chromium } = require(pwDir);

(async () => {
  const args = gpu === 'hw' ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-unsafe-webgpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args });
  const page = await (await browser.newContext({ viewport: { width: Number(w), height: Number(h) } })).newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)));
  await page.addInitScript(() => {
    const w = window;
    w.__perf = { frames: [], longTasks: [] };
    const loop = (t) => {
      w.__perf.frames.push(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__perf.longTasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  });
  // PERF_CSS: extra CSS injected into the page, to compare variants without editing the app.
  if (process.env.PERF_CSS) await page.addInitScript((css) => {
    const s = document.createElement('style');
    s.textContent = css;
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(s));
  }, process.env.PERF_CSS);
  if (blur === 'off') await page.addInitScript(() => {
    const s = document.createElement('style');
    s.textContent = '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(s));
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 'no WebGL2';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  console.log(`${label}: renderer ${renderer}`);
  await page.getByRole('button', { name: 'Run simulation' }).first().waitFor({ timeout: 120000 });
  if (view === '2d') await page.getByRole('radio', { name: '2D' }).first().click();
  await page.waitForTimeout(8000);

  const measure = async (name, ms) => {
    const t0 = await page.evaluate(() => performance.now());
    await page.waitForTimeout(ms);
    const r = await page.evaluate((t0) => {
      const f = window.__perf.frames.filter((t) => t >= t0);
      const gaps = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
      const lt = window.__perf.longTasks.filter((e) => e.start >= t0);
      const span = performance.now() - t0;
      return {
        fps: (f.length / span) * 1000,
        p95: gaps[Math.floor(gaps.length * 0.95)] ?? span,
        worst: gaps[gaps.length - 1] ?? span,
        longTasks: lt.length,
        blocked: lt.reduce((a, e) => a + e.dur, 0) / span,
      };
    }, t0);
    console.log(`${label.padEnd(16)} ${name.padEnd(10)} fps ${r.fps.toFixed(1).padStart(5)}  p95 ${r.p95.toFixed(0).padStart(5)} ms  worst ${r.worst.toFixed(0).padStart(5)} ms  long tasks ${String(r.longTasks).padStart(3)}  main thread blocked ${(r.blocked * 100).toFixed(0)}%`);
  };

  await measure('idle', 5000);
  const drag = async (dir) => {
    const x0 = Number(w) * 0.55;
    const y0 = Number(h) * 0.5;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 40; i++) {
      await page.mouse.move(x0 - dir * i * Number(w) * 0.004, y0 - dir * i * Number(h) * 0.002);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
  };
  // First pan loads new tiles; panning back over the same area measures rendering alone.
  for (const name of ['pan-new', 'pan-cached']) {
    const t0 = await page.evaluate(() => performance.now());
    await drag(name === 'pan-new' ? 1 : -1);
    const r = await page.evaluate((t0) => {
      const f = window.__perf.frames.filter((t) => t >= t0);
      const gaps = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
      return { fps: (f.length / (performance.now() - t0)) * 1000, p95: gaps[Math.floor(gaps.length * 0.95)] ?? 0 };
    }, t0);
    console.log(`${label.padEnd(16)} ${name.padEnd(10)} fps ${r.fps.toFixed(1).padStart(5)}  p95 ${r.p95.toFixed(0).padStart(5)} ms`);
    await page.waitForTimeout(2500);
  }
  if (quick === 'quick') {
    await browser.close();
    return;
  }
  await page.getByRole('button', { name: 'Run simulation' }).first().click();
  await page.waitForTimeout(3000);
  await measure('running', 12000);
  await page.screenshot({ path: `${label}.png`, timeout: 60000 });
  await page.waitForTimeout(20000);
  await measure('running-late', 10000);
  await page.screenshot({ path: `${label}-late.png`, timeout: 60000 });
  console.log(`${label.padEnd(16)} console errors: ${errors.length}`);
  for (const e of errors.slice(0, 8)) console.log('   ', e);
  await browser.close();
})().catch((e) => {
  console.error('PERF FAILED', e.message);
  process.exit(1);
});
