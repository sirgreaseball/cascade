# Cascade — engineering handoff

Written 14 September 2026 at the end of a long working session, for whoever (person or AI agent)
continues the work. Read all of it before changing anything. Every number here was measured; where
something was not measured, it says so.

---

## 0. Rules that are not negotiable

1. **Git identity.** Every commit is authored as `sirgreaseball <dhruuvvsonar@gmail.com>` (two u's,
   two v's). Set it repo-locally before the first commit and check it:
   `git config --local user.name sirgreaseball` and `git config --local user.email dhruuvvsonar@gmail.com`.
   The machine's global identity may belong to someone else; never commit under it.
   **No `Co-Authored-By` trailers** or any other attribution in commit messages.
2. **Small, verified commits, pushed to `main` straight away.** The owner pulls on several machines
   and must always get a working app. Never push something you have not run.
3. **Performance must never get worse.** 60 fps minimum — idle, panning and with a simulation
   running, in 3D — on the owner's main laptop: **Windows, NVIDIA GeForce GTX 1650 (4 GB), AMD
   Ryzen 5 4600H, 16 GB RAM, hybrid graphics**. The Mac ran smoothly; Windows is the target. Measure
   on the **production build** (`npm run build` + `npx next start`), not the dev server, and never
   on one run: identical runs differ by ±5 fps. Compare old and new in the same session.
4. **Architecture invariants** (they have broken the app before):
   - Arrays cross the Web Worker boundary by **structured cloning only**. Never pass a transfer list
     to `postMessage` — a detached buffer made the water invisible once.
   - The worker (`src/simulation/floodWorker.ts`) and the main-thread fallback
     (`src/simulation/adapters.ts`) both obtain their solver from the single factory
     `createRuntime(cfg, emit)` in `src/simulation/runtime.ts`. New solver parameters go into
     `EngineConfig` (`src/simulation/types.ts`), never into a second argument list.
5. **Do not modify `frontend/`** — the splash page is a separate Vite app.
6. **Report any new npm dependency to the owner before installing it.**
7. This is **Next.js 16** with breaking changes: read the relevant guide in
   `node_modules/next/dist/docs/` before writing Next-specific code (see `AGENTS.md`).
8. Visual design: dark "liquid glass" panels, Inter, amber accent; keep the layout.
9. Honest reporting: if a check fails, say so with the output. Do not claim "fixed" from a
   screenshot (see §7 — screenshots have lied here).

---

## 1. What Cascade is

A browser-based dam-break inundation dashboard for Smart India Hackathon problem **SIH26161**
(National Technical Research Organisation, disaster management). Pick a dam, break it, watch the
flood spread over 3D terrain, see who is hit, when, how deep and how fast, and export results.

- **Stack:** Next.js 16.3 (App Router, Turbopack), React 19.2, TypeScript 5, Zustand 5,
  Tailwind 4, Framer Motion; deck.gl 9.4 (+ luma.gl 9) over MapLibre 6.9 via react-map-gl.
- **Physics:** 2D shallow-water equations, Godunov finite volumes, HLL fluxes, hydrostatic
  reconstruction, point-implicit Manning friction, open boundaries — on the CPU (`swe.ts`) and on
  the GPU through WebGPU compute (`sweGpu.ts`). A second engine, SPH-SWE particles (`sph.ts`, CPU).
  Breach: Froehlich (2008) geometry and timing, level-pool reservoir routed against the live
  tailwater. Hazard AIDR 7-3, JRC depth–damage, Graham (1999) loss of life.
- **Data:** Terrarium elevation tiles (AWS, SRTM-derived), Esri World Imagery and Dark Gray Canvas
  basemaps, OpenStreetMap places/roads via Overpass (blocked on the owner's university Wi-Fi —
  use a hotspot for scenario builds).
- `cascade-reference.html` (repo root) is the owner's presentation reference on how the model works.

---

## 2. Where things are

```
src/app/                    page.tsx and dashboard/page.tsx both render components/Dashboard.tsx
src/components/Dashboard.tsx  boot, playback loop (usePlayback), keyboard, device check, loading veil
src/components/map/
  MapView.tsx               deck.gl + MapLibre; every map layer; flood frame function (floodFrame)
  hiResTerrain.ts           3D terrain tile loader: shared download queue, fallbacks, retries
  floodGpu.ts               flood textures (FloodField) + shader extension (FloodExtension)
  water.ts / haze.ts        water ripple/glint and aerial-haze shader extensions
  waterMesh.ts              the "flood skin" mesh (scenario DEM, lifted) the 3D flood is drawn on
  colormaps.ts              colour scales and the CPU painters still used for some layers
  terrain.ts                tile URLs, offline scenario-DEM terrain textures
src/components/panels/      LeftPanel (Event/Model/Observe; Model has the "This device" readout),
                            RightPanel (impacts), TopBar (scenario switcher + search, layers),
                            Timeline, ScenarioBuilder, ExportSheet, HistoricalCheck
src/components/useSimView.ts  primaryEngine, frame index, shared impact assessment
src/simulation/
  setup.ts                  grid + dam site + hydrograph → EngineConfig; Fast/Standard/Detailed
  runtime.ts                createRuntime; EngineRuntime (CPU) and GpuEngineRuntime
  swe.ts                    CPU grid solver (iterates only each row's wet span)
  sweGpu.ts                 WebGPU grid solver
  sph.ts, boundary.ts, hydrograph.ts, damSite.ts, season.ts, ensemble*.ts
  floodWorker.ts, adapters.ts, controller.ts (runs engines), results.ts (frame store), types.ts
src/store/                  simulationStore (setup, runs, playhead, view), scenarioStore, uiStore,
                            ensembleStore
src/lib/                    perfMonitor (device readout), evacuation, analytics, dams (catalogue),
                            damCrests, osm (Overpass), geo/terrarium, export/*, …
public/scenarios/*.json     bundled scenarios (tehri, bhakra, rishi-ganga, machchhu) + index.json
public/data/<id>/           elevation.bin (Float32, north-up, row-major), assets.geojson, roads.geojson
scripts/verify-engines.ts   `npm run verify`: analytical dam breaks, mass balance, Tehri SWE/SPH
scripts/bench/              browser benchmarks and checks (§6)
docs/handoff/               ready-to-apply edit specs (§8)
```

Frames: each engine emits a depth frame (Uint16 cm, scenario grid) every `outputInterval`
(duration/120, e.g. 180 s for 6 h) and a summary (max depth, arrival, max speed, max depth×velocity)
every fifth frame. `results.ts` keeps them outside React; `resultsVersion` in the store bumps on
every message. The playhead is advanced by the rAF loop in `Dashboard.tsx`.

---

## 3. History

- Before this session: CPU and WebGPU solvers, SPH, Machchhu II (1979) historical scenario with
  observations, ensemble ("Chance" layer), seasons, evacuation routing (v1), exports, Graham loss of
  life, the terrain loader that stitches imagery one zoom deeper, sun lighting, water skin.
- `e2704aa` (by another agent): continuous playback pacing, terrain fallbacks, `MAX_SPAN` 30→15 s and
  tailwater under-relaxation in `sweGpu.ts`. The playback part caused a per-frame CPU repaint that
  pulled a running simulation to 54 fps; the terrain part had bugs fixed in `1ffa23d`. Note: the
  tailwater relaxation exists only on the GPU path, and `MAX_SPAN` 15 doubles CPU↔GPU sync points.
- `257d407` **Performance readout** (Model tab → "This device"): the chip that draws the map and
  whether it is integrated, the WebGPU adapter the solver got or why it fell back to the CPU, fps and
  hitches, solver speed and share of time copying back from the GPU, terrain tile counters, and a
  "Copy performance report" button. `src/lib/perfMonitor.ts`.
- `1ffa23d` **Terrain tiles no longer go blank.** One download queue per server (10 at a time,
  shared between tiles, retries on network errors/429/5xx, cancelled only when no tile wants it);
  cancelled tiles reject instead of resolving; missing imagery/heights come from coarser data and the
  tile reloads when they arrive; Esri placeholder tiles detected; 512-px hidden basemap tiles.
- `8d6b4b0` **The flood is drawn on the GPU** (`floodGpu.ts`). Frames are
  uploaded once into reused textures; a shader blends the two frames around the playhead, colours by
  lookup table and reveals each cell at the second the water arrived (interpolated), so the front
  sweeps smoothly. MapView no longer re-renders per frame; deck.gl animates only while playing.
- Then this handoff (benchmark scripts, the tiled GPU solver spec, this document).

A failed experiment (terrain `meshMaxError` 2→1) sits in `git stash` as `stash@{0}`; it can be
dropped.

---

## 4. The plan and its status

The owner approved this order (desktop app dropped): **1 → 2 → 3 → 4 → 5 → 6, with 7 alongside,
then 9.** The two goals above everything: **better performance and better visuals.**

| # | Task | Status |
|---|------|--------|
| 1 | Performance readout | done (`257d407`) |
| 2 | Terrain artefacts (blank/dark tiles) | done (`1ffa23d`) |
| 3.1–3.2 | Flood coloured and animated on the GPU; smooth arrival-time front | done (`8d6b4b0`) |
| 3.3 | Steady live clock (no surge-and-stall while following a run) | done (`b8814f6`) |
| 3.4 | GPU solver computes only wet tiles | done (`9a0a988`) |
| 3.5 | GPU pacing so the map keeps 60 fps while the solver runs; dry-fragment early-out | done (`b53c280`) |
| 3.6 | Main-thread churn per frame message | done (`5faf0ad`) |
| 4 | Terrain detail everywhere; water in the terrain shader; reservoir at T+0; roads country-wide | done (`8f6276c`, `683d71e`) |
| 5 | Evacuation routes that follow the clock | done (`d55a843`) |
| 6 | Every dam in India; search by state, district and city | **next** — §9.6 |
| 7 | Code health: lint to zero; model accuracy checks | done (`6a3c538`) |
| 9 | Historical Events section; cascading dams | §9.8 |

Open decision for the owner: **SPH off by default?** It runs on the CPU and takes about four times
as long as even the CPU grid solver; recommended to default to the grid solver only, SPH one click
away.

---

## 5. Measured facts

All on the development laptop (Intel UHD Graphics, 16 threads), headless Chrome with
`--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist --enable-unsafe-webgpu`, 1600×1000, 3D, Tehri,
production build. **The owner's GTX 1650 has not been measured** — ask for the "Copy performance
report" output from that machine before and after GPU work.

| | fps idle | pan (new tiles) | pan (cached) | running | running, later |
|---|---|---|---|---|---|
| `e2704aa` (before this session's work) | 120.1 | 80.1 | 81.7 | 64.5 | 53.9 |
| terrain loader A/B, old (3 runs) | 120.0 | 76.5 | 77.7 | — | — |
| terrain loader A/B, new (6 runs) | 120.0 | 78.8 | 76.1 | — | — |
| GPU flood rendering | 120.1 | 82.0 | 77.1 | 56.0 | 56.0 |

- While running, the main thread is now idle (no long tasks); the limit on an integrated GPU is the
  WebGPU solver using the same chip back to back (8 ms submissions, one `mapAsync` each).
- **Solver speed, Tehri 6 h, grid only, 3D map on screen: GPU 443 s, CPU 42.7 s.** The GPU computes
  every cell of the 423×442 grid every step while the flood covers a few per cent of it; the CPU
  solver iterates only wet spans. Copying results back is ~1 % of GPU time — not the bottleneck.
- The default 3D view loads zoom-10 elevation tiles (~153 m between height samples); the underlying
  SRTM is ~30 m. Relief retained when coarsened to ~300 m: Tehri 88 %, Machchhu 36 % — flat sites
  lose most of their shape, which is why they look low-resolution.
- `npm run verify` passes (SWE mass error 1.85e-12 %, SPH 9.14e-3 %). Tehri flags verified:
  the eastern boundary of the study area bbox at 78.66°E cuts through the Bhagirathi river gorge
  at row 237 (lat 30.2055°N, bed ~490 m), where 839 Mm³ of the flood wave exits the open boundary
  prior to Devprayag. This starvation of the downstream valley explains why SWE never reaches
  Rishikesh in 6 h and why SWE/SPH extents diverge (CSI 0.26).
- OpenStreetMap holds 6,448 `waterway=dam` features in India (all sizes; Overpass count). CWC's
  National Register of Large Dams lists about 6,000 large dams. A Wikidata SPARQL count timed out.
- ESLint is at 0 errors, 0 warnings across the entire repository. Container sizing in `MapView.tsx`
  measured with a ResizeObserver; camera flights scheduled via `requestAnimationFrame`;
  evacuation state derived; unused directives and variables cleared. TypeScript is clean.

---

## 6. How to verify

```
npm run verify                       # CPU solvers; must stay passing whenever solver code changes
npx tsc --noEmit -p .
npx eslint <files you touched>
npm run build && npx next start -p 3100
```

**Browser checks (`scripts/bench/`).** Playwright is *not* a project dependency: install it in a
folder outside the repo (`npm i playwright` there) and pass that folder's
`node_modules/playwright` as the first argument. The scripts use the installed Chrome
(`channel: 'chrome'`) with real-GPU flags. Run them from a scratch directory: they write screenshots
to the current directory.

| Script | What it tells you |
|---|---|
| `perf.cjs <pw> <url> <label> 1600 1000 3d hw on [quick]` | fps idle / pan-new / pan-cached, and (without `quick`) running and running-late |
| `tilestats.cjs <pw> <url>` | the "This device" readout, including **Terrain tiles N loaded** — the proof terrain rendered |
| `terraincheck.cjs <pw> <url>` | erratic pans + deep zoom, tile request outcomes, screenshots, counters |
| `floodcheck.cjs <pw> <url>` | run, pause, scrub, every layer, 2D; console errors (shader failures) |
| `fluidity.cjs <pw> <url>` | % of frames the timeline clock stood still and the longest stall, live and replay |
| `gpubench.cjs <pw> <url>` | grid solver alone on the GPU, then on the CPU, wall time each |
| `gpucompare.cjs <pw> <outDir>` | Bhakra on GPU vs CPU: people, flooded area, first reached, mass balance |
| `readout.cjs <pw> <url>` | readout before/after a run and the copied report |
| `apply.cjs <spec>` | applies exact-text edits; writes nothing unless every block matches exactly once |
| `lintsum.cjs` | `npx eslint src -f json \| node scripts/bench/lintsum.cjs` → problems by rule |

Measure with the production server, three runs or more, old and new in the same session.

---

## 7. Gotchas learned the hard way

- **Screenshots of 3D terrain can lie.** When every terrain tile failed, the flat satellite basemap
  underneath still looked three-dimensional (satellite imagery carries its own shadows), and fps
  rose because there was nothing to draw. Proof that terrain loaded is the tile counter in the
  readout (`tilestats.cjs`).
- deck.gl's TileLayer treats a tile whose loader *resolves* as finished, even if it was cancelled —
  resolve only with complete content; reject on abort.
- deck.gl's default `fetch` expects a URL **string** (its resource manager calls `startsWith`):
  pass downloaded data as an object URL, not a Blob.
- Downloads shared between tiles must not be started with one tile's `AbortSignal`.
- Esri World Imagery answers missing imagery with a 2,521-byte flat grey "Map data not yet
  available" JPEG (seen at zoom 19 in India; zoom 18 was real where tested).
- **Chrome on Windows ignores WebGPU `powerPreference`** (crbug 369219127). On hybrid laptops the
  owner must set the browser to *High performance* in Windows Settings → System → Display →
  Graphics, then restart it; `chrome://gpu` should mark the NVIDIA GPU active.
- On Windows, stopping a background `npx next start` can orphan the node process, which keeps
  serving the **old build from memory** after a rebuild. Before benchmarking, kill whatever listens
  on the port (`netstat -ano | findstr :3100`, then `taskkill /PID <pid> /T /F`) and check the page
  is the new build.
- A production build and the dev server can run at the same time (dev output lives in `.next/dev`),
  but a running `next start` can lock `.next` files — stop it before `npm run build`.
- Overpass is blocked on the owner's university network.

---

## 8. Ready to apply: the tiled GPU solver (task 3.4)

`docs/handoff/tiled-gpu-solver.spec` holds 18 exact-text edits to `src/simulation/sweGpu.ts`,
dry-run against the current file (all match). Apply with:

```
node scripts/bench/apply.cjs docs/handoff/tiled-gpu-solver.spec
```

**Design.** The grid is split into 16×16 tiles. A tile *wakes* once a neighbouring tile holds water
and never sleeps again. The `update` kernel is dispatched in 2D, one workgroup per tile, and returns
at once for sleeping tiles; per-cell wave speed, edge outflow and wetness go to an `aux` buffer. A
`reduce` kernel (one thread per tile) summarises awake tiles; `finalize` (one thread) takes the global
CFL rate and outflow, advances the clock and wakes the neighbours of every wet tile. The old
per-workgroup `workgroupBarrier` reductions are gone. Each pipeline uses `layout: 'auto'`, so each
binds only what it uses and stays within the eight storage buffers a WebGPU device guarantees.

**Why it is exact.** Water moves less than one cell per step (CFL 0.45), so every cell adjacent to
a wet cell is in an awake tile before water can reach it; every face that carries flux has both
cells computed in the same step; cells in sleeping tiles are dry and identical in both ping-pong
buffers because they have never been written; tiles never sleep again, so no stale state reappears.

**Verify before committing:** `npx tsc --noEmit -p .`; `npm run verify` (CPU path unchanged, must
pass); `gpubench.cjs` before and after (baseline: GPU 443 s vs CPU 42.7 s for Tehri 6 h — expect a
large GPU speedup); `gpucompare.cjs` (GPU and CPU must agree as closely as before, mass balance
error < 1e-4); `floodcheck.cjs`; `perf.cjs` full. Also check the "Validation → Mass balance, this
run" row in the Model tab after a GPU run.

---

## 9. Designs for the remaining tasks

### 9.1 Steady live clock (3.3) — `src/components/Dashboard.tsx`, `simulationStore.goLive`

Today, while following a live run, the playhead advances at the playback speed capped by an
estimate of solver speed, runs into the newest result and stops until the next frame — a surge and
stall. Replace with a clock that trails the newest result by about one output interval at the
solver's smoothed pace, and plays at the chosen speed when the solver is faster than playback:

```ts
let pace = 0, lastLatest = 0, lastArrival = performance.now();
// in tick(now):
if (latest < lastLatest) { pace = 0; lastLatest = latest; lastArrival = now; }          // new run
else if (latest > lastLatest) {
  const measured = (latest - lastLatest) / Math.max((now - lastArrival) / 1000, 0.05);
  pace = pace > 0 ? pace * 0.7 + measured * 0.3 : measured;
  lastLatest = latest; lastArrival = now;
}
if (latest > 0 && (s.follow || s.playing)) {
  let speed = s.speed;
  if (s.follow && running) {
    const target = Math.max(0, latest - (s.setup?.outputInterval ?? 180));
    speed = Math.min(s.speed, Math.max(0, pace + (target - s.playhead) * 0.3));
  }
  let next = Math.min(latest, s.playhead + dt * speed);
  if (next >= latest && !running) { next = latest; s.setPlaying(false); s.setFollow(false); }
  if (next !== s.playhead) s.setPlayhead(next);
}
```

`goLive` should set the playhead to `max(0, latest − outputInterval)`. Measure with
`fluidity.cjs` (still-frame % and longest stall) before and after.

### 9.2 Share the GPU (3.5) and cheaper flood fragments

- `sweGpu.ts` submits ~8 ms of compute back to back (`GPU_SLICE_MS`) and waits on `mapAsync` after
  each. On one GPU this starves the map. While the map is animating, cap the solver's GPU duty
  cycle (for example, pause between submissions so compute stays under half of wall time); run flat
  out when playback is paused or the tab is hidden. Offer "compute as fast as possible" in Model
  settings. Do this after 3.4, whose speedup changes the numbers.
- `MAX_SPAN` 15 s (from `e2704aa`) forces a CPU↔GPU round trip per 15 simulated seconds for
  reservoir coupling; moving the level-pool routing (`BreachReservoir.outflow`, `hydrograph.ts`) into
  the `prepare` kernel would remove it.
- Flood shader (`floodGpu.ts`): dry fragments still do up to seven texture fetches. Early-out when
  the blended frame position is 0, and add a `hasImage` uniform so the observed-extent image is only
  sampled when there is one (set it from `floodFrame` in `MapView.tsx`).

### 9.3 Main-thread churn (3.6)

Every frame message bumps `resultsVersion`. `RightPanel` "Grid vs SPH" recomputes extent agreement
and depth difference over the whole grid, and `LeftPanel` validations do similar work, on every
frame. Split the counter into frames vs summaries and recompute envelope comparisons only on
summaries. Move exposure sampling (`sampleExposure` in `results.addFrame`) into the worker next to
the solver (through `EngineConfig`, respecting §0.4). Build the evacuation graph in a worker.

### 9.4 Terrain that looks right everywhere (4)

- More real detail: `zoomOffset: 1` on the HiResTerrainLayer for discrete GPUs (~153 → ~76 m
  samples at the default view, imagery ~76 → ~38 m/px); integrated GPUs keep today's detail. First
  move per-tile normal computation (`addNormals`, `hiResTerrain.ts`) off the main thread — tightening
  `meshMaxError` alone cost panning frames. Measure.
- Water that cannot clip through or float above terrain: sample the flood textures (§3) inside the
  terrain tile shader by position, instead of drawing a separate lifted mesh.
- Reservoir at T+0: SRTM (Feb 2000) predates Tehri's lake (2006); draw the reservoir as a level
  surface at pool height.
- Roads across the country: composite a road overlay into each terrain tile's texture in
  `tileTexture()` (Esri's World Transportation reference layer is a candidate — confirm the service
  and its terms first) and add it as a MapLibre raster layer in 2D; keep the study-area roads on top
  for flood-cut colouring. The owner explicitly wants the white road lines visible everywhere, not
  only near the selected dam.

### 9.5 Evacuation routes that follow the clock (5) — `src/lib/evacuation.ts`, `MapView.tsx`

Bugs today: routes are computed once after the run from the **final** flood extent, all leaving at
T+0, and drawn unchanged at every moment (so they sit over water later and never turn red); "safe"
means 400 m horizontally from any flooded cell, ignoring height (in gorges it rejects the hillside
above town); towns whose nearest junction is already clear get a one-segment stub; roads leaving the
study area can never be exits; cut-off towns are not drawn; routes draw through mountains
(`depthTest: false`); planning runs synchronously on the main thread.

Design: one reverse search per result, in a worker, giving every road junction the latest time you
can leave and still reach safety along the route with the most slack (label-correcting over edges:
`latest[u] = max over v of min(floods[u] − safety, latest[v] − cost, floods[v] − safety − cost)`,
safe nodes = +∞). At any playhead each town's route is then a lookup: green while leaving now still
works, red with "cut off at T+mm:ss" after. Safe = high ground above the nearby flood level plus a
margin (from the DEM). Roads turn red when they flood at the playhead. Draw depth-tested on the
terrain; mark cut-off towns. Test on Tehri and Machchhu at several timestamps: no green segment may
be under water at the time shown. (The owner asked for exactly this: "if we are at the 20th minute,
that green should change to red because that is not accessible anymore… on the specific timestamp,
whatever road we can use, the safest route".)

### 9.6 Every dam in India, searchable by state and city (6)

`src/lib/dams.ts` has 16 dams (one in Maharashtra), so searching "Maharashtra" shows one. Bundled
and custom scenarios cannot be found by state at all (`ScenarioMeta` has no state; `TopBar.tsx`
matches name and river only). Build a national catalogue with a script (CWC National Register of
Large Dams for attributes; OpenStreetMap/Wikidata for coordinates; record sources and licences),
load it only when search opens, and make typing a state list every dam in that state grouped by
district, a city or district list the dams there, with tolerant spelling. Render long lists
virtualised. Keep `catalogCrestLine` and the builder (`ScenarioBuilder.tsx`, `builderDam` in
`scenarioStore.ts`) working for entries with missing figures.

### 9.7 Code health and accuracy (7)

Bring ESLint to zero (§5 lists what remains; the hover card in `MapView.tsx` reads container size
from a ref during render — measure with a ResizeObserver instead). Investigate the Tehri flags in
§5 before anyone presents Tehri numbers.

### 9.8 Historical Events and cascading dams (9)

- A "Historical Events" group in the scenario switcher: Machchhu II (1979, bundled, with observed
  arrival/depth at Morbi and a comparison panel) first; Kedarnath/Chorabari (2013: ~0.65 Mm³
  released, breach opened in 10–12 min, published peak ~1,699 m³/s) next; the Sikkim 2023 South
  Lhonak lake outburst that destroyed the Teesta-III dam at Chungthang is a strong third candidate to
  research. Rejected: Tiware 2019 (published figures contradict by orders of magnitude) and
  Malpasset (needs the 1931 topography). The owner wants past events to match observations; be
  honest in the UI about what the model cannot capture (Machchhu's embankment failed in minutes,
  where Froehlich's formation time is ~2.5 h).
- Cascading dams: when the flood reaches a downstream dam (Koteshwar lies inside Tehri's study
  area), route it through that reservoir, check overtopping/breach, continue; also show the
  upstream reservoir draining.
