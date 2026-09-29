// What made frames late, from a trace recorded by trace.cjs.
//
//  1. How busy each important thread really was (top-level tasks as a share of the trace). This is
//     the number that says whether the main thread is the bottleneck. The Long Task figure in
//     perf.cjs cannot: it only sees tasks of 50 ms and more, and read 0 % while this read 99 %.
//  2. Frames on the renderer main thread (BeginMainFrame) and the gaps between them.
//  3. Main-thread JavaScript sampled inside the slow gaps only (longer than slowMs), mapped through
//     the build's source maps: by category, and by function, inclusive.
//  4. Everything else the main thread did inside those gaps (style, layout, paint, GC …), by self time.
//
// Source maps: build with `productionBrowserSourceMaps: true` (do not commit it). Turbopack names
// each map by its own hash, so the script follows each chunk's sourceMappingURL comment. The map for
// a library function's *definition* sometimes points into a helper the minifier inlined (deck.gl's
// _drawLayers came out as math.gl's mat4.ts), so library code is categorised by V8's function names,
// which survive minification for methods; app code maps reliably.
//
// usage: node slowframes.cjs <trace.json> [nextDir=<repo>/.next] [slowMs=17.5] [topN=30]
const fs = require('fs');
const path = require('path');
const repo = path.join(__dirname, '..', '..');
const { SourceMapConsumer } = require(path.join(repo, 'node_modules', 'source-map-js'));
const [, , file, nextDir = path.join(repo, '.next'), slowArg = '17.5', topArg = '30'] = process.argv;
const SLOW = Number(slowArg) * 1000;
const TOP = Number(topArg);
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const events = Array.isArray(raw) ? raw : raw.traceEvents;

// ---- Threads ------------------------------------------------------------------------------------
const procName = new Map();
const threadName = new Map();
for (const e of events) {
  if (e.ph !== 'M') continue;
  if (e.name === 'process_name') procName.set(e.pid, e.args.name);
  if (e.name === 'thread_name') threadName.set(`${e.pid}:${e.tid}`, e.args.name);
}
const durations = new Map();
for (const e of events) {
  if (e.ph !== 'X' || typeof e.dur !== 'number') continue;
  const k = `${e.pid}:${e.tid}`;
  if (!durations.has(k)) durations.set(k, []);
  durations.get(k).push(e);
}
let t0 = Infinity;
let t1 = -Infinity;
for (const list of durations.values()) for (const e of list) {
  t0 = Math.min(t0, e.ts);
  t1 = Math.max(t1, e.ts + e.dur);
}
const spanMs = (t1 - t0) / 1000;
const busyOf = (list) => {
  let busy = 0;
  let end = -Infinity;
  for (const e of list.slice().sort((a, b) => a.ts - b.ts)) {
    if (e.ts >= end) {
      busy += e.dur;
      end = e.ts + e.dur;
    } else if (e.ts + e.dur > end) {
      busy += e.ts + e.dur - end;
      end = e.ts + e.dur;
    }
  }
  return busy / 1000;
};
console.log(`trace ${spanMs.toFixed(0)} ms; thread busy time (share of the trace):`);
for (const [k, name] of threadName) {
  if (!/CrRendererMain|CrGpuMain|VizCompositorThread|^Compositor$|DedicatedWorker/.test(name)) continue;
  const list = durations.get(k);
  if (!list || list.length < 50) continue;
  const busy = busyOf(list);
  console.log(`  ${`${procName.get(Number(k.split(':')[0])) || '?'} / ${name}`.padEnd(40)} ${busy.toFixed(0).padStart(6)} ms  ${((busy / spanMs) * 100).toFixed(1).padStart(5)} %`);
}

// ---- Frames and gaps ----------------------------------------------------------------------------
const counts = new Map();
for (const e of events) {
  const k = `${e.pid}:${e.tid}`;
  if (threadName.get(k) === 'CrRendererMain') counts.set(k, (counts.get(k) || 0) + 1);
}
const main = [...counts].sort((a, b) => b[1] - a[1])[0][0];
const [mainPid, mainTid] = main.split(':').map(Number);
const onMain = (e) => e.pid === mainPid && e.tid === mainTid;
const frameStarts = events
  .filter((e) => onMain(e) && e.ph === 'X' && /BeginMainFrame$/.test(e.name))
  .map((e) => e.ts)
  .sort((a, b) => a - b);
const gaps = [];
for (let i = 1; i < frameStarts.length; i++) gaps.push([frameStarts[i - 1], frameStarts[i]]);
const slow = gaps.filter(([a, b]) => b - a > SLOW);
const frameSpan = (frameStarts[frameStarts.length - 1] - frameStarts[0]) / 1e6;
console.log(`\nmain thread ${main}: ${frameStarts.length} frames in ${frameSpan.toFixed(1)} s; ${slow.length} gaps over ${SLOW / 1000} ms (${((slow.length / Math.max(1, gaps.length)) * 100).toFixed(1)} %), ${(slow.reduce((s, [a, b]) => s + b - a, 0) / 1000).toFixed(0)} ms in all`);
const hist = {};
for (const [a, b] of gaps) {
  const ms = (b - a) / 1000;
  const bucket = ms < 8 ? '<8' : ms < 15 ? '8-15' : ms < 17.5 ? '15-17.5' : ms < 25 ? '17.5-25' : ms < 35 ? '25-35' : ms < 50 ? '35-50' : '50+';
  hist[bucket] = (hist[bucket] || 0) + 1;
}
console.log(`gap histogram (ms): ${JSON.stringify(hist)}`);
const inSlow = (ts) => {
  let lo = 0;
  let hi = slow.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (slow[mid][1] <= ts) lo = mid + 1;
    else if (slow[mid][0] > ts) hi = mid - 1;
    else return true;
  }
  return false;
};

// ---- Source maps --------------------------------------------------------------------------------
const consumers = new Map();
function consumer(url) {
  if (consumers.has(url)) return consumers.get(url);
  let c = null;
  const m = /\/_next\/(static\/.*\.js)$/.exec(url || '');
  if (m) {
    const js = path.join(nextDir, m[1]);
    if (fs.existsSync(js)) {
      const ref = /sourceMappingURL=([^\s]+)/.exec(fs.readFileSync(js, 'utf8').slice(-400));
      const p = ref ? path.join(path.dirname(js), ref[1]) : `${js}.map`;
      if (fs.existsSync(p)) c = new SourceMapConsumer(JSON.parse(fs.readFileSync(p, 'utf8')));
    }
  }
  consumers.set(url, c);
  return c;
}
const described = new Map();
function describe(cf) {
  const key = `${cf.url}:${cf.lineNumber}:${cf.columnNumber}:${cf.functionName}`;
  if (described.has(key)) return described.get(key);
  let out = { fn: cf.functionName || (cf.url ? '(anon)' : '(native)'), pkg: cf.url ? 'script' : /^\(/.test(cf.functionName) ? cf.functionName : 'native', file: '' };
  const c = consumer(cf.url);
  if (c && cf.lineNumber >= 0) {
    const pos = c.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber });
    if (pos.source) {
      const nm = /node_modules\/((?:@[^/]+\/)?[^/]+)\/(.*)$/.exec(pos.source);
      out = { fn: pos.name || cf.functionName || '(anon)', pkg: nm ? nm[1] : 'app', file: `${nm ? nm[2] : pos.source.replace(/^.*?\/src\//, 'src/')}:${pos.line}` };
    }
  }
  described.set(key, out);
  return out;
}

// ---- Main-thread JavaScript ---------------------------------------------------------------------
const profileTid = new Map();
const startOf = new Map();
for (const e of events) {
  if (e.name !== 'Profile' || e.pid !== mainPid) continue;
  profileTid.set(e.id, e.tid);
  startOf.set(e.id, e.args.data.startTime);
}
const nodes = new Map();
const streams = new Map();
for (const e of events) {
  if (e.pid !== mainPid || e.name !== 'ProfileChunk') continue;
  const d = e.args && e.args.data;
  if (!d || !d.cpuProfile) continue;
  for (const n of d.cpuProfile.nodes || []) nodes.set(`${e.id}:${n.id}`, n);
  if (!streams.has(e.id)) streams.set(e.id, { samples: [], deltas: [] });
  const st = streams.get(e.id);
  for (const s of d.cpuProfile.samples || []) st.samples.push(s);
  for (const t of d.timeDeltas || []) st.deltas.push(t);
}
let best = null;
for (const [id, st] of streams) if (profileTid.get(id) === mainTid && (!best || st.samples.length > best.st.samples.length)) best = { id, st };
if (!best) {
  console.log('\nno sampled JavaScript for the main thread (was the trace recorded by trace.cjs?)');
  process.exit(0);
}
const parentOf = new Map();
for (const [k, n] of nodes) if (k.startsWith(`${best.id}:`) && n.parent !== undefined) parentOf.set(k, `${best.id}:${n.parent}`);

// First category (in this order) that any frame on the stack matches.
const CATEGORIES = [
  ['deck.gl layer update (new tiles, changed props)', (f) => /^(updateLayers|_updateLayers|_updateSublayersRecursively|_initializeLayer|_transferLayerState|_updateLayer|_finalizeLayer|setLayers)$/.test(f.fn)],
  ['deck.gl draw', (f) => /^(_drawLayers|_drawLayersInViewport|_drawLayer|renderLayers)$/.test(f.fn)],
  ['React render / commit', (f) => /^(performWorkOnRoot|performSyncWorkOnRoot|flushSyncWorkAcrossRoots_impl|processRootScheduleInMicrotask|commitRoot|renderRootSync)$/.test(f.fn) || /react-dom/.test(f.file)],
  ['terrain tiles (app)', (f) => f.pkg === 'app' && /hiResTerrain\.ts|terrain\.ts/.test(f.file)],
  ['loaders.gl', (f) => f.pkg.startsWith('@loaders.gl')],
  ['framer-motion', (f) => /framer-motion|motion-dom/.test(f.pkg)],
  ['worker messages', (f) => f.pkg === 'app' && /controller\.ts|results\.ts|adapters\.ts/.test(f.file)],
  ['flood textures', (f) => f.pkg === 'app' && /floodGpu\.ts|colormaps\.ts/.test(f.file)],
  ['maplibre', (f) => /maplibre/.test(f.pkg)],
  ['luma.gl / deck.gl, other', (f) => f.pkg.startsWith('@luma.gl') || f.pkg.startsWith('@deck.gl')],
  ['app, other', (f) => f.pkg === 'app'],
];
const cat = { all: new Map(), slow: new Map() };
const incl = new Map();
const total = { all: 0, slow: 0 };
let t = startOf.get(best.id) || 0;
for (let i = 0; i < best.st.samples.length; i++) {
  t += best.st.deltas[i] || 0;
  const dt = (best.st.deltas[i + 1] || 0) / 1000;
  const key = `${best.id}:${best.st.samples[i]}`;
  const leaf = nodes.get(key);
  if (!leaf) continue;
  const leafD = describe(leaf.callFrame);
  if (leafD.fn === '(idle)') continue;
  const stack = [];
  for (let k = key; k; k = parentOf.get(k)) {
    const n = nodes.get(k);
    if (!n) break;
    stack.push(describe(n.callFrame));
  }
  let c = null;
  for (const [name, test] of CATEGORIES) if (stack.some(test)) { c = name; break; }
  if (!c) c = leafD.fn === '(garbage collector)' ? 'GC' : leafD.fn === '(program)' ? '(program): native work, style, layout, paint' : `other: ${leafD.pkg}`;
  const isSlow = inSlow(t);
  for (const which of isSlow ? ['all', 'slow'] : ['all']) {
    cat[which].set(c, (cat[which].get(c) || 0) + dt);
    total[which] += dt;
  }
  if (isSlow) {
    const seen = new Set();
    for (const f of stack) {
      if (f.pkg === 'native' || f.fn === '(root)') continue;
      const name = `${f.fn} [${f.pkg}] ${f.file}`;
      if (seen.has(name)) continue;
      seen.add(name);
      incl.set(name, (incl.get(name) || 0) + dt);
    }
  }
}
const print = (title, m, sum, n = TOP) => {
  console.log(`\n${title} (${sum.toFixed(0)} ms sampled)`);
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)) console.log(`  ${v.toFixed(1).padStart(8)} ms  ${((v / Math.max(sum, 1e-9)) * 100).toFixed(1).padStart(5)} %  ${k}`);
};
print('main-thread JavaScript by category, whole trace', cat.all, total.all, 20);
print('main-thread JavaScript by category, inside slow gaps', cat.slow, total.slow, 20);
print('by function (inclusive), inside slow gaps', incl, total.slow);

// ---- Everything else inside the slow gaps -------------------------------------------------------
const list = events.filter((e) => onMain(e) && e.ph === 'X' && typeof e.dur === 'number').sort((a, b) => a.ts - b.ts || b.dur - a.dur);
const open = [];
const self = new Map();
let busySlow = 0;
for (const e of list) {
  while (open.length && open[open.length - 1].end <= e.ts) open.pop();
  const rec = { end: e.ts + e.dur, child: 0 };
  if (open.length) open[open.length - 1].child += e.dur;
  else if (inSlow(e.ts)) busySlow += e.dur;
  open.push(rec);
  e.__rec = rec;
}
for (const e of list) if (inSlow(e.ts)) self.set(e.name, (self.get(e.name) || 0) + (e.dur - e.__rec.child) / 1000);
const slowTotal = slow.reduce((s, [a, b]) => s + b - a, 0) / 1000;
console.log(`\ninside slow gaps the main thread was busy ${(busySlow / 1000).toFixed(0)} ms of ${slowTotal.toFixed(0)} ms (${((busySlow / 1000 / Math.max(slowTotal, 1e-9)) * 100).toFixed(0)} %)`);
print('trace events by self time, inside slow gaps', self, [...self.values()].reduce((a, b) => a + b, 0), 20);
