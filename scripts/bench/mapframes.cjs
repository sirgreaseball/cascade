// How smoothly the MAP animates, as opposed to how often the page runs requestAnimationFrame.
//
// perf.cjs counts rAF callbacks, and once the map stopped redrawing on every frame that number
// stopped describing the map: rAF can run at 144 fps while the map redraws at 32. This script counts
// the frames in which the deck.gl canvas (`#deckgl-overlay`) actually issued draw calls, stamps each
// with its frame's rAF time (its vsync — when it is shown), and reports, per phase:
//
//   page  rAF frames per second, the share of gaps longer than 1/60 s, p95 and worst gap
//   map   map redraws per second, the share of gaps longer than 1/60 s (the moments the water or
//         the camera moved at under 60 fps), p95 and worst gap, and the "draw span" — how long the
//         main thread spent issuing one redraw's draw calls, a floor on what a redraw costs
//   long frames and the scripts behind them (Long Animation Frames API: 50 ms and up only)
//   terrain requests by zoom level, which shows whether fine terrain (zoomOffset 1) is on
//
// Phases: idle; pans (the old perf.cjs drag, one mouse move per ~31 ms — kept for comparison, it
// measures the script's input rate, not the map); fastpan (many mouse events per frame, so the map
// redraws on every frame it can); running (3-15 s after Run); late (33-43 s after Run).
//
// Compare builds by running them interleaved in one session, three rounds or more: the same build
// measured a day apart moved by 20-30 fps on the GTX 1650 laptop.
//
// usage: node mapframes.cjs <playwrightDir> <url> <label> [runSeconds=12] [width=1600] [height=1000] [pan=pan|nopan]
const [, , pwDir, url, label = 'map', runSeconds = '12', w = '1600', h = '1000', pan = 'pan'] = process.argv;
const { chromium } = require(pwDir);

(async () => {
  const args = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-unsafe-webgpu'];
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args });
  const page = await (await browser.newContext({ viewport: { width: Number(w), height: Number(h) } })).newPage();
  const requests = [];
  const tStart = Date.now();
  page.on('request', (r) => {
    const m = /terrarium\/(\d+)\//.exec(r.url());
    if (m) requests.push({ t: Date.now() - tStart, z: Number(m[1]) });
  });
  await page.addInitScript(() => {
    const P = WebGL2RenderingContext.prototype;
    const stats = { frames: 0, frameTime: 0, rafTimes: [], byCanvas: {}, loaf: [] };
    window.__mapframes = stats;
    const bucket = (gl) => {
      const c = gl.canvas;
      const key = (c.className && String(c.className).split(' ')[0]) || c.id || 'canvas';
      return (stats.byCanvas[key] ??= { draws: 0, drawFrames: 0, lastFrame: -1, times: [], spans: [], spanStart: 0, spanEnd: 0, drawsIn: [], frameDraws: 0 });
    };
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
      const orig = P[name];
      if (!orig) continue;
      P[name] = function (...a) {
        const b = bucket(this);
        const t = performance.now();
        b.draws++;
        if (b.lastFrame !== stats.frames) {
          if (b.spanEnd > b.spanStart) b.spans.push([b.spanStart, b.spanEnd - b.spanStart]);
          if (b.frameDraws > 0) b.drawsIn.push([b.spanStart, b.frameDraws]);
          b.frameDraws = 0;
          b.spanStart = t;
          b.lastFrame = stats.frames;
          b.drawFrames++;
          b.times.push(stats.frameTime);
        }
        b.spanEnd = t;
        b.frameDraws++;
        return orig.apply(this, a);
      };
    }
    // Registered before any page script, so it runs first in every frame and the frame's time is
    // known before the map draws.
    const loop = (t) => {
      stats.frames++;
      stats.frameTime = t;
      stats.rafTimes.push(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          stats.loaf.push({
            start: e.startTime,
            blocking: e.blockingDuration,
            scripts: (e.scripts || []).map((s) => ({ inv: s.invoker, type: s.invokerType, fn: s.sourceFunctionName, url: (s.sourceURL || '').replace(/^.*\/_next\//, '_next/'), pos: s.sourceCharPosition, dur: s.duration })),
          });
        }
      }).observe({ type: 'long-animation-frame', buffered: true });
    } catch {
      // Long Animation Frames are Chromium-only; everything else still works.
    }
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByRole('button', { name: 'Run simulation' }).first().waitFor({ timeout: 120000 });
  await page.waitForTimeout(8000);
  const now = () => page.evaluate(() => performance.now());
  const wall = () => Date.now() - tStart;
  const gapsOf = (times, t0, t1) => {
    const ts = times.filter((t) => t >= t0 && t < t1);
    const gaps = ts.slice(1).map((t, i) => t - ts[i]).sort((x, y) => x - y);
    return {
      count: ts.length,
      slow: gaps.length ? gaps.filter((g) => g > 17.5).length / gaps.length : 0,
      p95: gaps.length ? gaps[Math.floor(gaps.length * 0.95)] : 0,
      worst: gaps.length ? gaps[gaps.length - 1] : 0,
    };
  };
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const report = async (name, t0, t1, w0, w1) => {
    const secs = (t1 - t0) / 1000;
    const d = await page.evaluate(([t0, t1]) => {
      const s = window.__mapframes;
      const map = s.byCanvas['deckgl-overlay'];
      return {
        raf: s.rafTimes.filter((t) => t >= t0 - 100 && t < t1),
        map: map
          ? {
              times: map.times.filter((t) => t >= t0 - 100 && t < t1),
              spans: map.spans.filter((x) => x[0] >= t0 && x[0] < t1).map((x) => x[1]),
              draws: map.drawsIn.filter((x) => x[0] >= t0 && x[0] < t1).map((x) => x[1]),
            }
          : null,
        loaf: s.loaf.filter((e) => e.start >= t0 && e.start < t1),
      };
    }, [t0, t1]);
    const frames = gapsOf(d.raf, t0, t1);
    const blocking = d.loaf.reduce((sum, e) => sum + e.blocking, 0);
    const reqs = requests.filter((r) => r.t >= w0 && r.t < w1);
    const zooms = {};
    for (const r of reqs) zooms[r.z] = (zooms[r.z] || 0) + 1;
    console.log(`${label.padEnd(10)} ${name.padEnd(8)} page ${(frames.count / secs).toFixed(1).padStart(6)} fps  >1/60s ${pct(frames.slow).padStart(6)}  p95 ${frames.p95.toFixed(1).padStart(5)} ms  worst ${frames.worst.toFixed(0).padStart(4)} ms | long frames ${String(d.loaf.length).padStart(3)} (blocking ${blocking.toFixed(0)} ms) | terrain requests ${reqs.length} ${JSON.stringify(zooms)}`);
    if (d.map) {
      const m = gapsOf(d.map.times, t0, t1);
      const sp = d.map.spans.slice().sort((x, y) => x - y);
      const q = (f) => (sp.length ? sp[Math.min(sp.length - 1, Math.floor(sp.length * f))] : 0);
      const dr = d.map.draws.slice().sort((x, y) => x - y);
      const drawCalls = dr.length ? dr[dr.length >> 1] : 0;
      console.log(`${''.padEnd(19)} map  ${(m.count / secs).toFixed(1).padStart(6)} fps  >1/60s ${pct(m.slow).padStart(6)}  p95 ${m.p95.toFixed(1).padStart(5)} ms  worst ${m.worst.toFixed(0).padStart(4)} ms | draw span median ${q(0.5).toFixed(2)} ms, p95 ${q(0.95).toFixed(2)} ms | ${drawCalls} draw calls a redraw (median)`);
    }
    const byScript = {};
    for (const e of d.loaf) for (const s of e.scripts) {
      const k = `${s.type}:${s.inv} ${s.fn || ''} ${s.url}:${s.pos}`;
      byScript[k] = (byScript[k] || 0) + s.dur;
    }
    for (const [k, v] of Object.entries(byScript).sort((x, y) => y[1] - x[1]).slice(0, 4)) console.log(`${''.padEnd(19)} long-frame script ${v.toFixed(0).padStart(6)} ms  ${k.slice(0, 140)}`);
  };
  const phase = async (name, act) => {
    const w0 = wall();
    const t0 = await now();
    await act();
    await report(name, t0, await now(), w0, wall());
  };

  await phase('idle', () => page.waitForTimeout(5000));
  if (pan === 'pan') {
    const x0 = Number(w) * 0.55;
    const y0 = Number(h) * 0.5;
    const drag = async (dir) => {
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      for (let i = 1; i <= 40; i++) {
        await page.mouse.move(x0 - dir * i * Number(w) * 0.004, y0 - dir * i * Number(h) * 0.002);
        await page.waitForTimeout(16);
      }
      await page.mouse.up();
    };
    await phase('pans', async () => {
      await drag(1);
      await page.waitForTimeout(2500);
      await drag(-1);
    });
    await page.waitForTimeout(2500);
    await phase('fastpan', async () => {
      for (let k = 0; k < 4; k++) {
        const dir = k % 2 ? -1 : 1;
        await page.mouse.move(x0, y0);
        await page.mouse.down();
        await page.mouse.move(x0 - dir * Number(w) * 0.16, y0 - dir * Number(h) * 0.08, { steps: 90 });
        await page.mouse.up();
      }
    });
    await page.waitForTimeout(2500);
  }
  await page.getByRole('button', { name: 'Run simulation' }).first().click();
  await page.waitForTimeout(3000);
  await phase('running', () => page.waitForTimeout(Number(runSeconds) * 1000));
  await page.waitForTimeout(15000);
  await phase('late', () => page.waitForTimeout(10000));
  await browser.close();
})().catch((e) => {
  console.error('MAPFRAMES FAILED', e);
  process.exit(1);
});
