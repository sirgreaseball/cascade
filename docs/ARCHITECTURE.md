# Architecture

Cascade is two front ends served as one site, with no server code at all: every computation — the
solvers, the analytics, the exports — runs in the visitor's browser.

| Path | What | Source |
|---|---|---|
| `/` | The front page: a scroll-driven 3D splash (React Three Fiber, GSAP, Lenis) | `frontend/` (Vite), built into `public/splash/` |
| `/dashboard` | The simulator | `src/` (Next.js 16 App Router, React 19) |

`npm run build` builds the splash first (`prebuild` → `build:splash`, with `--include=dev` so it
also works where `NODE_ENV=production`), then `next build`. `next.config.ts` rewrites `/` to
`/splash/index.html` whenever the splash has been built; without it, `/` falls back to the
dashboard. Vercel builds and deploys `main` on every push (https://trycascade.vercel.app). Visits
are counted with Vercel Web Analytics (no cookies), once it is enabled for the project.

---

## Flow of a run

```
scenario JSON + DEM (elevation.bin) + exposure (assets / roads GeoJSON)      lib/scenario.ts
        │
        ▼
setupSimulation()                          simulation/setup.ts
  ├─ prepareDamSite()                      damSite.ts   wall burned into the DEM on the real crest
  │                                                     line, breach cells, downstream direction
  ├─ computeHydrograph()                   hydrograph.ts Froehlich (2008) breach + level-pool routing
  │                                                     (preview; the solvers route it live)
  ├─ resolution: Fast (2× cells) · Standard · Detailed (½ cells, WebGPU only)
  └─ EngineConfig × 2                      types.ts     one per solver, identical inputs
        │
        ▼
SimulationController                       controller.ts  one EngineClient per enabled solver
  └─ EngineClient                          adapters.ts    a Web Worker, or the main thread if none
       └─ createRuntime(cfg, emit)         runtime.ts     the ONE factory, for worker and fallback
            ├─ grid: races WebGPU against the CPU over the first 30 simulated s (raceTheProcessor)
            │    ├─ GpuShallowWaterSolver  sweGpu.ts    WGSL, 16×16 tiles woken by the water
            │    └─ ShallowWaterSolver     swe.ts       CPU, iterates each row's wet span
            └─ SPHSolver                   sph.ts       SPH-SWE particles, CPU
                 └─ InflowBoundary         boundary.ts  reservoir drained against the live tailwater
        │  frame every outputInterval (duration / 120): depth, Uint16 centimetres
        │  summary every 5th frame: max depth, arrival, max speed, max depth × velocity
        │  exposure sampled per frame over each settlement's footprint (exposure.ts)
        ▼
results store                              simulation/results.ts  outside React; the stores carry
        │                                                          only version counters
        ├─ MapView               components/map     the flood on the GPU, terrain, places, routes
        ├─ panels                components/panels  impact, places by arrival, comparison, charts
        └─ exports               lib/export         KML, Shapefile, GeoJSON, rasters, CSV, brief, CAP
```

The grid solver runs alone by default; SPH is one switch away in **Model → Solvers**, and after a
grid-only run the Impact panel offers it in one click. Both together give the Grid / SPH / Both
view, the Difference layer and the critical success index.

## Rules that keep it correct

- **Structured cloning only across the worker boundary.** No `postMessage` transfer lists: a
  transferred buffer is detached on the sending side, and the UI must never hold a detached array.
- **One call path per solver.** The worker (`floodWorker.ts`) and the main-thread fallback
  (`adapters.ts`) both get their runtime from `createRuntime` in `runtime.ts`. New solver inputs go
  into `EngineConfig` (`types.ts`), never into a second argument list.
- **Mass is conserved exactly.** Fluxes are conservative and edge outflow is tallied; SPH conserves
  to one particle volume. `npm run verify` checks both, and the Model tab shows the balance of the
  run on screen.

## Solvers

**Grid (2D shallow-water, finite volume).** Full depth-averaged momentum equations on the DEM grid:
Godunov scheme with HLL Riemann fluxes, hydrostatic reconstruction (Audusse et al. 2004) — well
balanced and depth-positive at wet–dry fronts — point-implicit Manning friction, CFL 0.45, open
outflow boundaries. The CPU version iterates only each row's wet span. The WebGPU version splits the
grid into 16×16 tiles that wake when a neighbour holds water, runs four kernels per step (prepare,
update, reduce, finalize), keeps the time step on the GPU, and paces itself while the map animates
unless **Compute as fast as possible** is on.

**Which one runs** is decided per grid size at the start of a run: both solvers take the first 30
simulated seconds and the GPU is kept only if it is within 2× of the CPU. See `docs/HANDOFF.md` §5
for what that race gets wrong on a discrete card.

**SPH (SPH-SWE).** Water as particles of fixed volume; depth is the kernel sum of neighbouring
volumes with a variable smoothing length; momentum from the depth gradient, the DEM bed slope,
Monaghan viscosity and implicit Manning friction (Vacondio et al. 2012). A counting-sort hash grid
finds neighbours. Particles are interpolated back onto the grid, so both solvers share maps,
analytics and comparison.

**Breach and events.** Dam break and lake outburst: a level-pool reservoir with a stage–storage
power law drains through a trapezoidal breach that grows over the formation time (broad-crested
weir, Fread's submergence correction against the tailwater the 2D flow computes). A blockage lake's
volume is measured from the terrain when the scenario is built (`lib/blockageLake.ts`). Controlled
release: a ramped gate discharge. Cloudburst: rain on every grid cell for the grid solver, a lumped
runoff hydrograph for SPH. The season sets reservoir level, base flow and roughness together. An
imported hydrograph replaces the routing entirely.

## Rendering

deck.gl 9.4 and luma.gl over MapLibre 6.9 (react-map-gl).

- **Terrain.** `HiResTerrainLayer` (`map/hiResTerrain.ts`): Terrarium elevation tiles to zoom 17
  (heights cut from zoom 15), imagery stitched one zoom deeper, a shared download queue with
  retries and coarser fallbacks. One zoom finer (`zoomOffset: 1`) only on a discrete GPU and a link
  measured, from the network rather than the cache, at 30 Mbps or more; on a slower link satellite
  imagery stops at zoom 17. A page that starts offline draws the scenario's own DEM as a single
  mesh; a connection lost later keeps the world terrain already on screen.
- **A lost graphics context** (driver reset, GPU memory pressure) remounts the map with a fresh
  basemap (`useMapRecovery`, `Dashboard.tsx`). The scenario and results live in the stores, so only
  the camera starts over.
- **Flood.** Frames are uploaded once into reused textures (`map/floodGpu.ts`); a shader blends the
  two frames around the playhead, colours through lookup tables and reveals each cell at the second
  the water arrived. In 3D it is drawn on a lifted mesh of the scenario DEM, in 2D on a quad. The map
  redraws when the playhead moves, not on every display frame.
- **Everything else.** Water glints and aerial haze as shader extensions; one sun for relief;
  places sized and faded by population certainty; roads turning red where cut; evacuation routes
  (green while leaving now still works, red once cut off) planned in a worker; SPH particles; the dam
  marker and the breach pulse.
- `map/lumaOverhead.ts` removes per-draw work luma.gl repeats for nothing (uniform-block lookups,
  sampler debug strings).

## State

- `scenarioStore` — the open scenario, its DEM and exposure index, imported observations and
  external model results, the builder.
- `simulationStore` — event parameters, solver settings, run status, playhead and view settings.
  Large arrays stay in `results` and are read through version counters.
- `uiStore` — panels, sheets, picking mode, toasts. `ensembleStore` — the ensemble's progress and
  result.

## Analytics, inputs and outputs

- **Impact** (`lib/analytics.ts`): people exposed over each settlement's footprint, arrival, depth,
  AIDR H1–H6 hazard (`lib/damage.ts`), JRC depth–damage loss, Graham (1999) loss of life with a
  warning lead time (`lib/lifeLoss.ts`), bridges, facilities and road length cut.
- **Uncertainty**: a 12-member Latin-hypercube ensemble over breach width, formation time and
  roughness (`simulation/ensemble*.ts`), drawn as the chance of flooding.
- **Validation**: live analytical benchmarks (`simulation/benchmarks.ts`); agreement with another
  model or a satellite extent (`lib/compare.ts`: CSI, hit rate, false alarms, depth RMSE); the
  recorded arrival and depth for historical scenarios (`panels/HistoricalCheck.tsx`); the reservoirs
  either side of the failure (`lib/cascading.ts`).
- **Earth Engine** (`lib/gee.ts`): a Sentinel-1 change-detection script (UN-SPIDER method) for the
  study area, with windows around the event for scenarios that happened; `scripts/gee/nrt_flood.py`
  runs the same method headless.
- **Inputs**: the scenario builder (any dam or blockage: catalogue, live OpenStreetMap search or a
  click on the map; automatic study area; SRTM tiles or an uploaded DEM; OpenStreetMap or uploaded
  exposure); spreadsheets (`lib/xlsx.ts`, no dependency) carrying a hydrograph, dam figures or
  settlements; observed extents (GeoJSON, KML, GeoTIFF); external depth rasters (GeoTIFF, ASCII).
- **Outputs** (`lib/export/`): KML, zipped Shapefile, GeoJSON, ESRI ASCII rasters, a CSV
  evacuation list, a printable one-page brief and a CAP 1.2 alert in English and Hindi.
- **This device** (`lib/perfMonitor.ts`): which chip draws the map and which runs the solver, frame
  timing, solver speed, terrain tile counts and link speed, copyable as a report.
