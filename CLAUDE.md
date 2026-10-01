# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

Cascade is a browser-only dam-break inundation simulator for Smart India Hackathon problem SIH26161
(NTRO). There is no server code: solvers, analytics and exports all run in the visitor's browser.
Live at https://trycascade.vercel.app (splash at `/`, simulator at `/dashboard`). **`main` is
production — every push to it deploys there — and day-to-day work goes to `dev`** (see Branches).
`docs/HANDOFF.md` is the canonical engineering handoff (status, measured
figures, benchmarks, gotchas); `docs/ARCHITECTURE.md` is the short version. Keep status out of this
file.

## Rules (docs/HANDOFF.md §0)

- Commits are authored `sirgreaseball <dhruuvvsonar@gmail.com>` (repo-local config; check
  `git config user.email` first). No `Co-Authored-By` trailers or AI attribution of any kind.
- Small, verified commits, pushed to `dev` straight away. Never push what you have not run or what
  does not build.
- Ask the owner before adding any npm dependency.
- Performance must never get worse: 60 fps minimum (idle, panning, during a run, in 3D) on the target
  laptop — Windows, GTX 1650, Ryzen 5 4600H, hybrid graphics. Measure on the production build, three
  runs or more, old and new in the same session.
- Design: dark "liquid glass" panels, Inter, amber accent `#f59e0b`. The splash (`frontend/`) keeps
  its own look (cinematic, monospace labels, serif headline) and relative links (`/dashboard`).

## Branches

- `dev` gets every change, however small: commit there after the gate and push. Vercel builds each
  push to it as a preview deployment, not the live site.
- `main` is production: the live site, and the branch GitHub shows. It takes only major changes —
  features, fixes to bugs visitors can hit, measured performance work, solver changes that passed
  `npm run verify`. Docs, tooling and small tweaks wait on `dev` and ride along with the next one.
- Releasing: squash `dev` into one commit on `main` that names the major change, then merge `main`
  straight back into `dev` before anything else lands there (otherwise the next squash conflicts):

```bash
git checkout main && git pull && git merge --squash dev && git commit -m "<the major change>" && git push
git checkout dev && git merge --no-edit main && git push
```

## Commands

```bash
npm run dev                  # dev server; slower rendering — never benchmark it
npm run build                # builds the splash (frontend/ -> public/splash/) then next build, as Vercel does
npx next start -p 3000       # production server: / splash, /dashboard simulator (npm run demo = build + start)
npx tsc --noEmit -p .        # type check
npx eslint src               # lint (or just the files you touched); must be clean
npm run verify               # headless solver checks in Node: Ritter/Stoker dam breaks, lake at rest,
                             # mass balance, Tehri end to end on both solvers
npm run verify -- bhakra --swe                            # one scenario, grid solver only
npm run verify -- tehri --duration 7200 --resolution fast
cd frontend && npx oxlint src                             # lint the splash
```

Gate before every commit: `tsc` and `eslint` clean, plus `npm run verify` whenever solver code
changed.

Browser checks are `scripts/bench/*.cjs` (what each one measures: HANDOFF §6). Playwright is not a
project dependency: install it in a folder outside the repo and pass its `node_modules/playwright` as
the first argument, e.g.
`node scripts/bench/mapframes.cjs <pw> http://localhost:3000/dashboard <label> [runSeconds]`. They use
the installed Chrome with real-GPU flags and write screenshots to the current directory, so run them
from a scratch folder.

## Architecture

Two front ends, one site: `frontend/` is a Vite + React Three Fiber splash built into
`public/splash/` (git-ignored), which `next.config.ts` rewrites `/` to when it exists; `src/` is the
Next.js App Router dashboard (`src/app/dashboard/page.tsx` → `components/Dashboard.tsx`).

Flow of a run:

1. Scenario config + DEM + exposure (`lib/scenario.ts`). Bundled scenarios live in
   `public/scenarios/*.json` + `public/data/<id>/` (`elevation.bin` is Float32, north-up, row-major;
   assets and roads GeoJSON). User-built scenarios live in IndexedDB.
2. `simulation/setup.ts` `setupSimulation()`: the dam is burned into the DEM on its crest line
   (`damSite.ts`), the Froehlich breach hydrograph is computed (`hydrograph.ts`), the resolution is
   chosen, and one `EngineConfig` (`types.ts`) is built per solver.
3. `simulation/controller.ts` runs one `EngineClient` (`adapters.ts`) per enabled solver — a Web
   Worker (`floodWorker.ts`) or a main-thread fallback. Both get their solver from `createRuntime` in
   `runtime.ts`.
4. The grid solver is CPU `swe.ts` or WebGPU `sweGpu.ts`, chosen by racing both over the first 30
   simulated seconds (`raceTheProcessor`). SPH-SWE is `sph.ts`; reservoir inflow is `boundary.ts`.
5. Engines emit Uint16-centimetre depth frames every duration/120 and a summary every fifth frame.
   `simulation/results.ts` keeps them outside React; the stores carry only version counters. The rAF
   loop in `Dashboard.tsx` advances the playhead.
6. Consumers: `components/map/MapView.tsx` (every map layer), `components/panels/*`, `lib/export/*`
   (KML, Shapefile, GeoJSON, rasters, CSV, brief, CAP).

Invariants that have broken the app before:

- Arrays cross the worker boundary by **structured cloning only** — never a `postMessage` transfer list.
- One call path per solver: new solver inputs go into `EngineConfig`, never a second argument list.
- Mass is conserved exactly; `npm run verify` checks it.

Map: deck.gl 9.4 + luma.gl over MapLibre (react-map-gl). `map/hiResTerrain.ts` is the terrain layer
(Terrarium tiles, imagery stitched one zoom deeper, a shared download queue with retries and coarser
fallbacks); `map/floodGpu.ts` uploads flood frames into reused textures that a shader colours; the map
redraws when the playhead moves, not on every frame. `scripts/copy-workers.mjs` copies loaders.gl's
terrain worker into `public/workers/` on install, dev and build.

State (Zustand, `src/store/`): `scenarioStore` (scenario, DEM, exposure, imports, builder),
`simulationStore` (event parameters, solver settings, runs, playhead, view), `uiStore`,
`ensembleStore`.

## Gotchas (full list: HANDOFF §7)

- On Windows a background `next start` can keep serving the old build from memory. Kill whatever
  listens on :3000 before benchmarking or after a rebuild:
  `Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`.
  A running `next start` also locks `.next`, and reads `public/` only at start.
- Vercel builds with `NODE_ENV=production`; that is why `build:splash` installs with `--include=dev`.
- Screenshots of 3D terrain can lie (the flat satellite basemap looks 3D). Prove terrain loaded with
  the tile counter (`tilestats.cjs`).
- deck.gl TileLayer: resolve a tile loader only with complete content; reject on abort. Pass
  downloaded data as URL strings, not Blobs.
- Cached tiles look like fast downloads: measure link speed with Resource Timing and drop entries
  under 10 ms.
- A hidden or covered Chrome window stops rAF: playback freezes and screenshots time out.
- Overpass (OpenStreetMap) is blocked on the owner's university Wi-Fi, and answers 406 to requests
  without a User-Agent.
- Benchmark scripts must set switches to a state, never click them blind.
