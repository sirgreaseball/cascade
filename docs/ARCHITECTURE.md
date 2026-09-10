# Architecture

## Flow of a run

```
scenario JSON + DEM (.bin) + exposure (GeoJSON)
        │
        ▼
setupSimulation()            src/simulation/setup.ts
  ├─ prepareDamSite()        damSite.ts   wall burned into the DEM, breach cells, downstream direction
  ├─ computeHydrograph()     hydrograph.ts free-outflow preview (Froehlich 2008 breach + weir routing)
  └─ EngineConfig × 2        one per solver, identical inputs
        │
        ▼
SimulationController         controller.ts  one EngineClient per enabled solver
  └─ EngineClient            adapters.ts    Web Worker, or main-thread fallback
       └─ EngineRuntime      runtime.ts     the only code that drives a solver
            ├─ ShallowWaterSolver  swe.ts   2D SWE, finite volume (HLL + hydrostatic reconstruction)
            └─ SPHSolver           sph.ts   SPH for the shallow-water equations
                 └─ InflowBoundary boundary.ts  reservoir drained against the live tailwater
        │  frames (depth, cm), summaries (peak depth, arrival, velocity, depth×velocity)
        ▼
results store                results.ts     frames + per-place exposure samples, outside React
        │
        ├─ MapView           components/map  deck.gl: 3D terrain, flood raster, particles, places
        ├─ panels            components/panels  impact, places by arrival, comparison, charts
        └─ exports           lib/export     KML, Shapefile, GeoJSON, ASCII grid, CSV
```

## Rules that keep it correct

- **Structured cloning only across the worker boundary.** No `postMessage` transfer lists: a transferred buffer is detached on the sending side, and the UI must never hold a detached array.
- **One call path per solver.** The worker (`floodWorker.ts`) and the main-thread fallback (`adapters.ts`) both construct `EngineRuntime` from the same `EngineConfig`. New solver inputs belong in `EngineConfig`, never in a second argument list.
- **Mass is conserved exactly.** The grid solver's fluxes are conservative and edge outflow is tallied; SPH conserves to one particle volume. `npm run verify` checks both.

## Solvers

**Grid (2D shallow-water, finite volume).** Full depth-averaged momentum equations on the DEM grid. HLL Riemann fluxes with hydrostatic reconstruction (Audusse et al. 2004) make it well-balanced and depth-positive on wet/dry fronts; Manning friction is point-implicit; the time step follows the CFL limit. Only the wet bounding box is iterated.

**SPH (SPH-SWE).** Water as particles of fixed volume; depth is the kernel sum of nearby volumes with a variable smoothing length; momentum from the depth gradient, the DEM bed slope, Monaghan viscosity and implicit Manning friction (Vacondio et al. 2012). A counting-sort hash grid finds neighbours. Particles are interpolated back to the grid with a mass-normalised kernel so both solvers share maps, analytics and comparison.

**Breach.** Level-pool reservoir with a stage–storage power law, draining through a trapezoidal breach that grows over the formation time (broad-crested weir, SI coefficients). Inside the solvers the tailwater comes from the 2D flow at the channel below the dam, with Fread's submergence correction, so a drowned breach passes less water.

## State

- `scenarioStore` — the open scenario, its DEM and exposure index, imported observations and external model results.
- `simulationStore` — event parameters, solver settings, run status, playhead and view settings. Large arrays stay in `results` and are read through version counters.
- `uiStore` — panels, sheets and toasts.

## Rendering

The flood is painted into an `ImageData` per frame (colour lookup tables, depth interpolated between frames) and shown as a `BitmapLayer`, draped on a `TerrainLayer` built from the scenario's own DEM in 3D. One texture per frame instead of one object per cell keeps large grids smooth.
