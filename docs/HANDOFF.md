# Cascade — engineering handoff

Written 14 September 2026 at the end of a long working session, for whoever (person or AI agent)
continues the work, and last brought up to date on 29 September 2026, the eve of the Smart India
Hackathon submission, after the site was deployed. Read all of it before changing anything. Every
number here was measured; where something was not measured, it says so.

**The live site is https://trycascade.vercel.app** — the splash at `/`, the simulator at
`/dashboard` — deployed from `main` on every push.

---

## 0. Rules that are not negotiable

1. **Git identity.** Every commit is authored as `sirgreaseball <dhruuvvsonar@gmail.com>` (two u's,
   two v's). Set it repo-locally before the first commit and check it:
   `git config --local user.name sirgreaseball` and `git config --local user.email dhruuvvsonar@gmail.com`.
   The machine's global identity may belong to someone else; never commit under it.
   **No `Co-Authored-By` trailers** or any other attribution in commit messages.
2. **Small, verified commits, pushed to `main` straight away.** The owner pulls on several machines
   and must always get a working app — and every push to `main` is deployed to the live site by
   Vercel. Never push something you have not run, and never push something that does not build:
   `npm run build` builds the splash as well as the dashboard, exactly as Vercel does.
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
5. **`frontend/` is the splash page** — a separate Vite app, built into `public/splash/` and served at
   `/`. It used to be off limits; the owner lifted that on 29 September 2026. Keep its own look
   (cinematic, monospace labels, serif headline) and its links relative (`/dashboard`).
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
Everything runs in the browser; there is no server code. `docs/ARCHITECTURE.md` is the short
version of how it fits together.

- **Site:** one Next.js app on Vercel. `/` is the splash (`frontend/`, built in by `npm run build`
  and rewritten to by `next.config.ts`), `/dashboard` the simulator. Locally, `npx next start -p
  3000` serves both the same way.

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
frontend/                   the splash (Vite, React Three Fiber, GSAP); `npm run build` builds it into
                            public/splash/ (base /splash/, git-ignored) and next.config.ts serves it at /
src/app/                    dashboard/page.tsx renders components/Dashboard.tsx; page.tsx does too, and
                            takes "/" only when the splash has not been built
src/components/Dashboard.tsx  boot, playback loop (usePlayback), keyboard, device check, loading veil
src/components/map/
  MapView.tsx               deck.gl + MapLibre; every map layer; flood frame function (floodFrame)
  hiResTerrain.ts           3D terrain tile loader: shared download queue, fallbacks, retries
  floodGpu.ts               flood textures (FloodField) + shader extension (FloodExtension)
  water.ts / haze.ts        water ripple/glint and aerial-haze shader extensions
  waterMesh.ts              the "flood skin" mesh (scenario DEM, lifted) the 3D flood is drawn on
  colormaps.ts              colour scales and the CPU painters still used for some layers
  terrain.ts                tile URLs, offline scenario-DEM terrain textures
  lumaOverhead.ts           stops luma.gl repeating per-draw and per-texture work (`781e62a`)
src/components/panels/      LeftPanel (Event/Model/Observe; Model has the "This device" readout),
                            RightPanel (impacts, the one-click SPH check), TopBar (scenario
                            switcher + search, layers), Timeline, Legend, ScenarioBuilder,
                            ExportSheet, HistoricalCheck, CascadingReservoir, FirstRun (the tour)
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
                            damCrests, osm (Overpass, Nominatim), gee (Earth Engine script),
                            cascading (reservoirs panel), xlsx + importers, geo/terrarium, export/*, …
public/scenarios/*.json     bundled scenarios (tehri, bhakra, rishi-ganga, machchhu) + index.json
public/data/<id>/           elevation.bin (Float32, north-up, row-major), assets.geojson, roads.geojson
scripts/verify-engines.ts   `npm run verify`: analytical dam breaks, mass balance, Tehri SWE/SPH
scripts/bench/              browser benchmarks and checks (§6)
docs/handoff/               the tiled GPU solver's edit spec, applied long ago (§8)
docs/samples/               a sample file for every import, built from Tehri's own terrain (`fce797f`)
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
- `2c9af10` (by another agent): continuous playback pacing, terrain fallbacks, `MAX_SPAN` 30→15 s and
  tailwater under-relaxation in `sweGpu.ts`. The playback part caused a per-frame CPU repaint that
  pulled a running simulation to 54 fps; the terrain part had bugs fixed in `c9520a6`. Note: the
  tailwater relaxation exists only on the GPU path, and `MAX_SPAN` 15 doubles CPU↔GPU sync points.
- `e220cb8` **Performance readout** (Model tab → "This device"): the chip that draws the map and
  whether it is integrated, the WebGPU adapter the solver got or why it fell back to the CPU, fps and
  hitches, solver speed and share of time copying back from the GPU, terrain tile counters, and a
  "Copy performance report" button. `src/lib/perfMonitor.ts`.
- `c9520a6` **Terrain tiles no longer go blank.** One download queue per server (10 at a time,
  shared between tiles, retries on network errors/429/5xx, cancelled only when no tile wants it);
  cancelled tiles reject instead of resolving; missing imagery/heights come from coarser data and the
  tile reloads when they arrive; Esri placeholder tiles detected; 512-px hidden basemap tiles.
- `a66edb1` **The flood is drawn on the GPU** (`floodGpu.ts`). Frames are
  uploaded once into reused textures; a shader blends the two frames around the playhead, colours by
  lookup table and reveals each cell at the second the water arrived (interpolated), so the front
  sweeps smoothly. MapView no longer re-renders per frame; deck.gl animates only while playing.
- Then this handoff (benchmark scripts, the tiled GPU solver spec, this document).
- 28 September: sample files for every import (`fce797f`); terrain detail chosen by measured
  bandwidth (`4d91e3e`, corrected in `824ecd7` — see §7 and §9.4); dam picking on the map from the
  144-dam catalogue, snapping to the nearest dam (`0b979ab`, `f73b4f2`, `e9f696b`), with a one-dam
  OpenStreetMap lookup when the catalogue has never heard of it (`92bc4da`; the bulk fetch that
  would extend the catalogue itself, `scripts/fetch-osm-dams.ts`, has never completed — §4);
  places drawn as faintly as their population is uncertain (`3df75a5`); the timeline
  drawn against the scenario and sliders centred on its defaults (`3c2a878`, `1e59294`); Run and
  the transport controls trade places without moving the clock (`f985e86`).
- 29 September, main-thread work per frame on the GTX 1650 (`781e62a`–`0ddde4b`): luma.gl's
  per-draw uniform-block lookups cached (two WebGL calls, some 40,000 of each a second at 144 Hz,
  7–8 % of the main thread); the MapLibre angle round trip that repainted the basemap on every
  render of MapView (§7); the flood redrawn only when the playhead moves, not on every display
  frame; the breach pulse built apart from the other layers; the timeline and Event tab
  re-rendering only the parts that move; pacing messages to the workers only when the answer
  changes; terrain normals 3.15 → 0.72 ms per 16,641-vertex tile, and the normals worker that
  nothing imported removed. `6735a07` renamed the long-task figure for what it counts (§5).
- 29 September, for the submission: the Cascade mark and the author line on the splash
  (`ff964fa`); splash and dashboard served as one site, `/` and `/dashboard`, with relative links
  (`d1dd430`); `metadataBase` from the production host (`c9b17b8`); the Vercel project, and its
  first failed build fixed (`9ef5d76`, §7); wording that promised two solvers the default run does
  not start, and a one-click SPH check after a grid run (`c3a36ac`); the reservoirs panel reading
  its levels off the model (`f1f1a27`); the controls appearing after 9 s even when no terrain tile
  arrives (`4240faf`); Earth Engine windows around the event for scenarios that happened
  (`4bf7927`). The whole-run GPU against CPU timing (§5) was measured that morning.

A failed experiment (terrain `meshMaxError` 2→1) used to sit in `git stash`; the stash is empty
now (checked 29 September).

---

## 4. The plan and its status

The owner approved this order (desktop app dropped): **1 → 2 → 3 → 4 → 5 → 6, with 7 alongside,
then 9.** The two goals above everything: **better performance and better visuals.**

| # | Task | Status |
|---|------|--------|
| 1 | Performance readout | done (`e220cb8`) |
| 2 | Terrain artefacts (blank/dark tiles) | done (`c9520a6`) |
| 3.1–3.2 | Flood coloured and animated on the GPU; smooth arrival-time front | done (`a66edb1`) |
| 3.3 | Steady live clock (no surge-and-stall while following a run) | done (`43058de`) |
| 3.4 | GPU solver computes only wet tiles | done (`d108b13`) |
| 3.5 | GPU pacing so the map keeps 60 fps while the solver runs; dry-fragment early-out | done (`02b226e`) |
| 3.6 | Main-thread churn per frame message | done (`c801057`) |
| 4 | Terrain detail everywhere; water in the terrain shader; reservoir at T+0; roads country-wide | done (`ecbb1af`, `939c68b`) |
| 5 | Evacuation routes that follow the clock | done (`ecec4b9`) |
| 6 | Dam catalogue searchable by state, district and city; live OpenStreetMap search beyond it | partly (`bd34479`, `92bc4da`): the catalogue holds 144 dams, not every dam in India — see below |
| 7 | Code health: lint to zero; model accuracy checks | done (`23138fa`) |
| 9 | Historical Events section; cascading dams | done (`04e73f2`) |

Decided: **SPH is off by default** (`f8d84dc`, 14 September), one switch away in the Model tab and
one click away in the Impact panel after a grid run. It runs on the CPU: in `npm run verify` on the
GTX 1650 laptop (29 September) Tehri 9 h took 141 s on the grid solver and 231 s on SPH, and in the
browser at the Fast setting 15 s against 2 min.

**Open decisions for the owner** (29 September 2026):

1. **Keep the WebGPU grid solver, and fix the race that never picks it?** Over a whole Tehri run the
   GTX 1650 beats the processor (§5), but the 30-second race refuses it on every machine ever
   measured. Recommended: keep it, race over a later or longer slice (or by adapter class), run
   the GPU probe without the map-pacing pauses, and check GPU and CPU results agree with
   `gpucompare.cjs` before changing who wins. It is also what makes the Detailed setting (half-size
   cells) viable at all.
2. **Retry the bulk OpenStreetMap dam fetch?** `public/data/dams-national.json` holds the 144
   curated dams; `scripts/fetch-osm-dams.ts` would add every mapped dam and reservoir in India,
   state by state, but has failed part-way on slow links (about one state in ten minutes). Needs a
   connection Overpass answers on (not the university network). Until then, dam search beyond the
   catalogue depends on reaching OpenStreetMap live.
3. **Frame rate during a run on the GTX 1650** has not been measured since the 29 September
   main-thread work (§5). Measure map redraws with `mapframes.cjs`, old and new builds interleaved.

---

## 5. Measured facts

The first table is from the development laptop (Intel UHD Graphics, 16 threads); the owner's
GTX 1650 laptop, the performance target, is measured further down. Both with headless Chrome,
`--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist --enable-unsafe-webgpu`, 1600×1000, 3D, Tehri,
production build.

| | fps idle | pan (new tiles) | pan (cached) | running | running, later |
|---|---|---|---|---|---|
| `2c9af10` (before this session's work) | 120.1 | 80.1 | 81.7 | 64.5 | 53.9 |
| terrain loader A/B, old (3 runs) | 120.0 | 76.5 | 77.7 | — | — |
| terrain loader A/B, new (6 runs) | 120.0 | 78.8 | 76.1 | — | — |
| GPU flood rendering | 120.1 | 82.0 | 77.1 | 56.0 | 56.0 |

- While running there were no long tasks — which does not mean the main thread was idle (see the
  GTX 1650 correction below); the limit on an integrated GPU is the
  WebGPU solver using the same chip back to back (8 ms submissions, one `mapAsync` each).
- **Solver speed, Tehri 6 h, grid only, 3D map on screen: GPU 443 s, CPU 42.7 s.** The GPU computes
  every cell of the 423×442 grid every step while the flood covers a few per cent of it; the CPU
  solver iterates only wet spans. Copying results back is ~1 % of GPU time — not the bottleneck.
- The default 3D view loads zoom-10 elevation tiles (~153 m between height samples); the underlying
  SRTM is ~30 m. Relief retained when coarsened to ~300 m: Tehri 88 %, Machchhu 36 % — flat sites
  lose most of their shape, which is why they look low-resolution.
- `npm run verify` passes (SWE mass error 1.57e-13 %, SPH 6.81e-3 %; measured 27 September 2026,
  and again on 29 September at `824ecd7`, where every figure below came out the same).
  Tehri, 9 h: SWE reaches Rishikesh at **6h 09m**, 7.0 m deep over 35 % of the town; SPH at
  **3h 39m**, 18.0 m over 98 %. Devprayag: SWE 1h 33m, SPH 1h 14m, both ~138 m. New Tehri and
  Virbhadra stay dry, correctly — New Tehri is the resettlement town on the ridge at 1818 m, and
  Virbhadra's cells sit ~28 m above the highest nearby water surface. SWE/SPH extent agreement is
  **CSI 0.39**.
- **A correction, because this document said otherwise until 27 September 2026.** It previously
  claimed the study area's eastern boundary at 78.66°E cut the Bhagirathi gorge, spilling 839 Mm³
  out of the domain and starving the valley, and that this was why SWE never reached Rishikesh.
  That is wrong in every part, and it was wrong because `verify-engines.ts` sampled the single
  100 m cell under each place name: Rishikesh's lands on a terrace above the river and read 0.0 m,
  so the flood looked absent when it was merely beside that one cell. Measured instead:
  - The main stem leaves through the **south** edge at 78.2403°E carrying 1,329 km² of catchment
    — 71 % of the basin — and it does so *downstream of Rishikesh*, which is correct and
    unavoidable; the river has to leave somewhere. The east-edge cell at row 237 is real but
    drains 43 km², a side tributary.
  - The flood travels the whole 99 km channel, reaching 78.23°E at the western edge.
  - Extending the bounding box would therefore fix nothing. The fix was to read exposure over
    each settlement's footprint, as `src/lib/analytics.ts` and the dashboard always had.
  Two further things were measured and are *not* the cause, recorded so nobody re-runs them:
  carving the DEM's 835 channel depressions into a continuous bed (477 uphill steps → 1) changed
  the result by nothing; nor did running 24 h instead of 9 h, which moved 84 % of the water out of
  the domain while leaving the inundation envelope identical at 89.0 km².
- **The owner's GTX 1650 has now been measured** (28 September 2026), on the production build,
  headless Chrome with the real GPU, 1600×1000, 3D, Tehri. The map draws on the NVIDIA card:
  `ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 … D3D11) [discrete]`, 12 threads, 16 GB.
  - **The WebGPU solver loses the race here too**, by 8–12× over the opening slice, so through the
    interface the grid solver runs on the processor on this machine exactly as it does on
    integrated graphics.
  - **Over a whole run the graphics card wins** (measured 29 September 2026). Tehri 9 h, grid
    solver alone, 3D map following the run, wall time from Run to "Finished in", `gpubench.cjs`
    against a throwaway build with the race bypassed (never committed), runs interleaved in one
    page:

    | | run 1 | run 2 |
    |---|---|---|
    | WebGPU, paced for the map (the default) | 174.5 s | 177.4 s |
    | WebGPU, "Compute as fast as possible" | — | 118.4 s |
    | Processor | 214.7 s | 208.9 s |

    The adapter was the NVIDIA card (`turing`), not the integrated AMD chip. The card is about
    1.2× faster than the processor as a user would run it, and 1.8× flat out (one sample) — the
    opposite of the race's verdict. The race samples the first 30 simulated seconds, when the flood
    is smallest: each GPU submission's fixed cost (four dispatches and a `mapAsync` round trip)
    dominates, while the processor iterates a handful of wet cells. The race's GPU probe also runs
    with the map-pacing pauses on (`throttled = !cfg.unthrottled`, never switched off for the
    probe) while the processor runs flat out — a handicap of about 2×, as large as the race's
    tolerance. See open decision 1 in §4.
  - The same processor solver finished that run in **141 s in `npm run verify`** (Node, no map)
    against 209–215 s in the browser's worker with the map drawing. Not yet explained.
  - The 190–209 s processor timings recorded here on 28 September came from `gpubench` runs that
    also had SPH computing (§7). They fall in the same range as the clean runs above, so SPH on
    other cores did not measurably slow the grid solver on this 12-thread machine.
  - **Frames, four clean runs** (nothing else on the machine), against §5's integrated-laptop row:

    | | idle | pan (new tiles) | pan (cached) | running | running, later |
    |---|---|---|---|---|---|
    | Intel UHD, `a66edb1` | 120.1 | 82.0 | 77.1 | 56.0 | 56.0 |
    | GTX 1650, 28 Sep 2026 | 116.5 / 136.8 / 141.1 / 143.8 | 92.6 / 130.0 / 141.9 / 142.0 | 98.3 / 138.5 / 143.1 / 143.8 | 30.0 / 31.6 / 35.1 / 45.1 | 49.4 / 50.3 / 50.5 / 50.7 |

    Drawing is far better on the discrete card — about **140 fps** idle and panning against the
    integrated laptop's 77–120. The low first sample in each column is a cold tile cache, not the
    renderer. **Running is worse**: a median near **33 fps**, settling to a very repeatable
    **50 fps** later in a run. Both are under the 60 fps floor rule 3 sets, and both are *below*
    the integrated laptop's 56, even though the same processor path runs the solver on both.
    **Correction (29 September):** this paragraph used to say the main thread was idle throughout
    (blocked 1–3 %), so the cost was not main-thread work. That figure counts only tasks of 50 ms
    and more (`6735a07`); a CDP trace of a run showed the renderer main thread **99 % busy**, in
    pieces of 5–20 ms — a full map redraw on every display frame. `781e62a`–`0ddde4b` (§3) removed
    the causes the trace named. The figures above predate those commits, and `perf.cjs` counts
    rAF callbacks, not map redraws. This document has no running figure measured since, with
    `mapframes.cjs` and old and new builds interleaved; until it does, whether a run holds 60 fps
    on the target machine is the open performance question.
  - Measure on a quiet machine. Two benchmark browsers at once cost 11 fps of idle and more than
    half of running — a contaminated sample looked like a catastrophic regression and was not one.
- **`scripts/bench/gpubench.cjs` used to report the wrong backend.** It labelled its first run
  "grid on GPU" because the switch defaults on, but the switch only *offers* the graphics card and
  the race may refuse it — so it printed processor timings under a GPU heading. It now reads the
  backend that actually ran out of the device panel and says plainly when that is not the one asked
  for. Its switch selector was also still the pre-race wording. Treat any GPU-vs-CPU figure taken
  before 28 September 2026 as unattributed. It also clicked "SPH solver" blind, so from `f8d84dc`
  (14 September) every run it timed had SPH running too (§7); since 29 September it sets each
  switch to a state and checks it took.
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
npx eslint src                       # dashboard (0 errors, 0 warnings)
npm run build                        # splash + dashboard, exactly what Vercel runs
npx next start -p 3000               # http://localhost:3000/ splash, /dashboard simulator
```

In `frontend/`, `npx oxlint src` lints the splash (a handful of pre-existing `react(purity)`
warnings about `Math.random` in its particle scenes). After a push, the deployment shows up in the
Vercel project `cascade` (account `sirgreaseball`), and the live site should answer 200 on `/`,
`/dashboard`, `/splash/favicon.svg`, `/scenarios/index.json` and `/workers/terrain-worker.js`.

**Browser checks (`scripts/bench/`).** Playwright is *not* a project dependency: install it in a
folder outside the repo (`npm i playwright` there) and pass that folder's
`node_modules/playwright` as the first argument. The scripts use the installed Chrome
(`channel: 'chrome'`) with real-GPU flags. Run them from a scratch directory: they write screenshots
to the current directory.

| Script | What it tells you |
|---|---|
| `perf.cjs <pw> <url> <label> 1600 1000 3d hw on [quick]` | rAF fps idle / pan-new / pan-cached, and (without `quick`) running and running-late. Since `589b9df` the map no longer redraws on every rAF, so this is the page's frame rate, not the map's; its long-task figure counts only tasks over 50 ms |
| `mapframes.cjs <pw> <url> <label> [runSeconds]` | how often the **map** redraws (frames in which the deck.gl canvas issued draw calls), share of gaps over 1/60 s, draw span, long frames with their scripts, terrain requests by zoom — idle, pans, fast pans, running, late |
| `trace.cjs <pw> <url> <label> <idle\|pan\|running\|late>` | a CDP trace with the V8 sampler on, for `slowframes.cjs`; tracing halves the frame rate, so read proportions from it, never fps |
| `slowframes.cjs <trace.json> [nextDir]` | how busy each thread really was, frame gaps, and the main-thread JavaScript inside slow gaps by category and function (needs a build with `productionBrowserSourceMaps: true` — never commit that) |
| `tilestats.cjs <pw> <url>` | the "This device" readout, including **Terrain tiles N loaded** — the proof terrain rendered |
| `terraincheck.cjs <pw> <url>` | erratic pans + deep zoom, tile request outcomes, screenshots, counters |
| `floodcheck.cjs <pw> <url>` | run, pause, scrub, every layer, 2D; console errors (shader failures) |
| `fluidity.cjs <pw> <url>` | % of frames the timeline clock stood still and the longest stall, live and replay |
| `gpubench.cjs <pw> <url> [runs=gpu,cpu]` | grid solver alone (SPH set off): `gpu` offered the card and paced for the map, `gpufast` with "Compute as fast as possible", `cpu` held to the processor, in the order given; wall time each and the backend that actually ran — the race (`raceTheProcessor`) may refuse the card, see §5 |
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
  on the port (in PowerShell: `Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object
  { Stop-Process -Id $_.OwningProcess -Force }`) and check the page is the new build.
- `next start` reads the list of `public/` files when it starts: a file added afterwards answers
  404 until the server is restarted.
- A production build and the dev server can run at the same time (dev output lives in `.next/dev`),
  but a running `next start` can lock `.next` files — stop it before `npm run build`.
- Overpass is blocked on the owner's university network. Separately, Overpass answers a request
  that carries no User-Agent with a 406, which looks like a block and is not.
- **A cached response looks like a fast download.** A terrain tile served from the browser's cache
  took 0.5–1.1 ms by Resource Timing, but resolves in JavaScript only when the page gets round to it
  — tens of milliseconds later while a scenario loads — so a JavaScript stopwatch cannot tell it
  from a download. Counted as downloads, cached tiles made an 8 Mbps link read 401–485 Mbps on every
  reload and switched on the four-times-heavier terrain (`824ecd7`). Measure the network with
  Resource Timing (`performance.getEntriesByName(url, 'resource')`) and discard entries under 10 ms.
- **MapLibre does not hand back the angles it is given.** It stores pitch and bearing in radians
  and returns degrees, so 55° comes back as 55.00000000000001; react-map-gl sees a changed camera
  and calls `map._render()` synchronously, on every render of MapView. The camera's angles are
  settled to values that survive the round trip (`b854bc8`).
- **The Long Task API cannot say how busy the main thread is.** It reports only tasks of 50 ms and
  more; a trace showed the thread 99 % busy in 5–20 ms pieces while the long-task figure read 0 %.
  Use `trace.cjs` and `slowframes.cjs` for that question.
- **Benchmark scripts must set a switch to a state, never click it blind.** `gpubench.cjs` clicked
  "SPH solver" assuming it started on; SPH has been off by default since `f8d84dc`, so from then on
  the click turned it on, and every "grid solver alone" timing also ran SPH.
- **Vercel builds with `NODE_ENV=production`**, under which `npm install` leaves out
  devDependencies. The splash's TypeScript and Vite are devDependencies, so its build failed on
  Vercel ("Cannot find module 'vite'") while passing everywhere else; `build:splash` installs with
  `--include=dev` (`9ef5d76`). Reproduce Vercel locally by building a clean clone with
  `NODE_ENV=production`.
- **A hidden or covered browser window stops drawing.** Chrome reports the page `hidden` when its
  window is minimised or fully covered, and stops `requestAnimationFrame`: the playback clock
  freezes while the solver worker keeps computing, framer-motion transitions stall half-way, and
  screenshots time out. Keep the window in front for demos, recordings and measurements.
- The splash's `* { cursor: none }` hides the system pointer for its custom cursor, on purpose.

---

## 8. The tiled GPU solver (task 3.4, applied)

Applied in `d108b13` from the 18 exact-text edits in `docs/handoff/tiled-gpu-solver.spec`, which is
kept for the record — do not apply it again.

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

**To check it after any change to `sweGpu.ts`:** `npx tsc --noEmit -p .`; `npm run verify` (the CPU
path must still pass); `gpubench.cjs` (before tiling, Tehri 6 h took 443 s on Intel UHD against
42.7 s on the CPU; §5 has the tiled solver's GTX 1650 figures); `gpucompare.cjs` (GPU and CPU must
agree, mass balance error < 1e-4); `floodcheck.cjs`. Also read the "Mass balance, this run" row in
the Model tab after a GPU run.

---

## 9. Designs behind the tasks in §4

All of these have been built (see the table in §4); they are kept because the reasoning is still
the best explanation of why the code is the way it is.

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
- `MAX_SPAN` 15 s (from `2c9af10`) forces a CPU↔GPU round trip per 15 simulated seconds for
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
  *Built:* `zoomOffset: 1` applies on a discrete GPU once 12 tiles fetched from the network (not the
  cache) have arrived at 12 Mbps or more (`4d91e3e`, `824ecd7`, `src/lib/perfMonitor.ts`); the
  verdict latches, so detail can rise once and never falls. Normals stayed on the main thread and
  now cost a quarter of what they did (`0ddde4b`).
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
