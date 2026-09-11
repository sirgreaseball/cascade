# Cascade

**Dam-break and flash-flood intelligence for Indian rivers.** Cascade simulates what happens downstream when a dam breaches, a landslide lake bursts or a spillway opens: how much water leaves, where it goes, when it arrives, how deep and fast it gets, who and what is in the way — and it checks the model against satellite observations.

Built for Smart India Hackathon problem statement **SIH26161** (National Technical Research Organisation): *Dam Break Inundation Modelling Using Hydrodynamic Modelling of any River.*

## What it does

| Deliverable (SIH26161) | In Cascade | Where on screen |
|---|---|---|
| Generalised framework for dam break / river blockage, sudden surge, loss & damage | Breach hydrograph from reservoir routing (Froehlich 2008 breach, weir flow, tailwater submergence) feeding two hydrodynamic solvers; AIDR H1–H6 hazard, JRC depth–damage losses, loss of life from Graham (1999) fatality rates with and without warning, per-place arrival times | **Event** tab (dam break, lake outburst or release; breach sliders); **Impact** panel on the right; **Hazard** and **Arrival** layers |
| SPH and Delft3D models, compared | **SPH-SWE** particle solver and a **2D shallow-water finite-volume** solver (the physics of Delft3D-FLOW in 2D), run side by side, compared by critical success index, depth difference and flooded area over time; real Delft3D / HEC-RAS max-depth rasters can be imported and compared too | **Grid / SPH / Both** switch at the top right; **Difference** layer; **Model** tab → *Compare with another model* |
| A model a jury can trust | Analytical benchmarks run live in the browser: Ritter (dry bed) with grid convergence, Stoker (wet bed, moving bore), lake at rest over rough terrain, and the mass balance of the run just computed; method, equations and references listed | **Model** tab → *Method and validation* → *Run analytical benchmarks* |
| Tool to generate scenarios from different input datasets | Scenario builder for any Indian dam: SRTM terrain fetched automatically (or upload GeoTIFF / ASCII DEM — ASTER, CartoDEM, SRTM), exposure from OpenStreetMap (or upload GeoJSON), dam crest line from OpenStreetMap, river path found automatically | Dam name at the top left → *New scenario for any river…* |
| Dashboard for input and output; large data; .shp / .kml output | Web dashboard; the grid solver runs on the graphics card (WebGPU) with a Web Worker fallback; raster rendering scales to ~400k cells; exports KML, zipped Shapefile, GeoJSON, ESRI ASCII rasters, a CSV evacuation table and a CAP 1.2 alert in English and Hindi | Whole dashboard; **Export** at the top right |
| Near-real-time flood analysis through Google Earth Engine | Generates a Sentinel-1 change-detection script (UN-SPIDER method) for the open scenario; `scripts/gee/nrt_flood.py` runs it headless; the observed extent is imported and scored against the model | **Observe** tab |
| Demonstrate on real Indian river and dam data | Bundled: Tehri (Bhagirathi–Ganga), Bhakra (Sutlej), Rishi Ganga lake outburst (Chamoli) — SRTM terrain, OpenStreetMap exposure; a catalogue of 16 major dams with their real crest lines | Dam name at the top left |

## Run it

**One click.** Install [Node.js](https://nodejs.org) (LTS), then:

- Windows: double-click **`start.cmd`**
- macOS / Linux: run **`./start.sh`**

It installs dependencies the first time, builds the optimised version and opens http://localhost:3000.

**From a terminal:**

```bash
npm install
npm run demo         # optimised build, fastest — use this to present
npm run dev          # development mode with hot reload (slower rendering)
```

The dashboard is served at `/` and `/dashboard`. Bundled scenarios work offline once built; satellite imagery, the scenario builder, OpenStreetMap and Earth Engine need a connection.

**Browsers:** current Chrome, Edge, Firefox or Safari (16.4+) with hardware acceleration on. The map needs WebGL 2; the simulation runs in Web Workers (with an automatic main-thread fallback).

## Verify the physics

```bash
npm run verify                       # lake-at-rest, mass-balance, Ritter and Stoker tests + Tehri, both solvers
npm run verify -- bhakra --swe       # one scenario, grid solver only
```

## Rebuild bundled data

```bash
npm run data:build                   # all scenarios in public/scenarios/index.json
npm run data:build -- tehri --no-osm
```

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Zustand · deck.gl 9 + MapLibre GL · Web Workers · Tailwind CSS 4 · Framer Motion.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together and [docs/DATA_PIPELINE.md](docs/DATA_PIPELINE.md) for data formats.

## Data and credits

Terrain: AWS Open Data Terrain Tiles (SRTM, NASA/USGS). Exposure: © OpenStreetMap contributors. Imagery: Esri, Maxar, Earthstar Geographics. Sentinel-1: Copernicus / ESA via Google Earth Engine. Dam figures are approximate public values; verify with the dam owner before operational use. Loss estimates are indicative.
