# Tasks Breakdown (6-Person Team)

## Person 1: Team Lead / Integrator
- Repository setup, branch management, and merging.
- App shell architecture (Next.js layout).
- Vercel/Netlify deployment.
- Final demo stability checks.

## Person 2: Map / Terrain Engineer
- Implement MapLibre GL JS dark base map.
- Configure Deck.gl integration.
- Implement `TerrainLayer` for 3D ground.
- Implement visual `GridCellLayer` or `BitmapLayer` for the flood.

## Person 3: Simulation Engineer
- Write the TypeScript Web Worker (`floodWorker.ts`).
- Implement the cellular automata / gravity flow algorithm.
- Manage memory via `Float32Array` and optimize for 30+ FPS.

## Person 4: UI / Command Center Engineer
- Build the Dashboard layout (Left/Right panels, Alert Log).
- Implement sliders, controls, and readouts.
- Add Framer Motion animations for that "Emergency Operations" feel.

## Person 5: GIS / Data Engineer
- Download and prepare DEM data (QGIS/GDAL).
- Crop data to 512x512 grids and export to binary for the simulation.
- Prepare GeoJSON for villages, hospitals, roads, and bridges.
- Create scenario JSON config files.

## Person 6: Analytics / QA / Pitch
- Implement Turf.js intersection logic.
- Trigger alerts based on flood arrival times.
- Write the demo script and prepare the pitch deck.
- Record the backup demo video.
