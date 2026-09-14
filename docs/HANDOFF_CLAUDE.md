# CASCADE ENGINEERING HANDOFF FOR CLAUDE

**Date:** 14 September 2026
**Repository:** `sirgreaseball/cascade` (Next.js 16 + React 19 + Deck.gl 9.4 + luma.gl 9 + WebGPU/WebGL2)
**Git Identity Rule:** Commits MUST be authored locally as `sirgreaseball <dhruuvvsonar@gmail.com>` with NO `Co-Authored-By` or AI attribution.

---

## 1. Executive Status & Summary

### What is Working & Fixed:
1. **GPU Flood Water Simulation (2D):**
   - The simulation runs fluidly and cleanly using WebGPU compute with CPU fallback.
   - All physics verification checks (`npm run verify`) pass 100%: SWE mass balance relative error $1.85 \times 10^{-12}\%$, SPH-SWE particles error $9.14 \times 10^{-3}\%$, all synthetic dam-break tests pass.
   - 2D mode works completely and seamlessly with smooth arrival front blending.
2. **Evacuation Routes Overhaul:**
   - Overhauled in `src/lib/evacuation.ts` and `src/components/map/MapView.tsx`.
   - Replaced invisible 2.5px lines with a high-contrast 3-layer architecture (`evacuation-halo` 14–24px, `evacuation-casing` 8.5–13px dark outline, `evacuation-core` 4.5–7.5px neon emerald green `#10f57d` / crimson `#f43f5e`).
   - Precomputes safe routes for all settlements in the study area.
   - Elevated Z-coordinates to `SKIN_LIFT + 6` (+14m) so routes sit above roads and never z-fight.
3. **Removed the Giant Blue Blob:**
   - Removed the unconstrained synthetic 100km+ polygon generator (`computeReservoirPolygon` and `reservoir` layer) that previously blocked the horizon.
4. **Fixed Deck.gl 9 Shader Compilation Crash:**
   - In `src/components/map/floodGpu.ts` and `src/components/map/water.ts`, removed undeclared `cameraPosition` and `position_commonspace` from fragment shader hooks (`fs:DECKGL_FILTER_COLOR`), which previously threw fatal WebGL shader compilation errors.

---

### What is BROKEN (Immediate Action Items for Claude):

#### Issue 1: Basemap / Initial View Mismatch (Monochrome Map shown instead of Satellite)
- **Symptom:** When the application boots up, the top-right toggle displays **"Satellite"** as active, but the map rendered on screen is the **monochrome dark-grey / black-and-white road map** (or black void with roads), NOT the satellite imagery.
- **Root Cause & Investigation Paths:**
  - Look at `src/components/map/MapView.tsx` lines 975–992:
    ```tsx
    <MapGL
      reuseMaps
      mapStyle={
        (view.terrain3d && terrainMode === 'world'
          ? view.basemap === 'satellite' ? SATELLITE_STYLE_3D : LIGHT_STYLE_3D
          : view.basemap === 'satellite' ? SATELLITE_STYLE : LIGHT_STYLE) as never
      }
    />
    ```
  - In `SATELLITE_STYLE` (lines 54–65):
    - It defines source `imagery` with `IMAGERY_URL` (ArcGIS World Imagery).
    - But MapLibre / react-map-gl initialization might fail to load raster tiles on initial render or the deck.gl canvas on top obscures it, or `view.basemap` in `simulationStore.ts` initial state vs MapLibre style sync is dropping tiles.
    - Check why `SATELLITE_STYLE` layer order or tile loading does not display satellite imagery upon booting. When switching toggles or loading, it stays monochrome.

#### Issue 2: 3D Terrain is GONE / No Depth / Flat Void
- **Symptom:** When toggling to 3D mode, the 3D terrain does NOT exist or has no depth. The terrain surface is completely missing or flat black, and the roads and water appear floating in empty space with zero 3D relief.
- **History & What Broke It:**
  - In commit `683d71e` ("Render flood water in terrain shader, remove flood-skin mesh, and add T+0 reservoir level pool"):
    - The author deleted `buildGridMesh` and `SimpleMeshLayer` (`id: 'flood-skin'`) and tried to inject `FLOOD_TERRAIN` (`FloodExtension`) into `HiResTerrainLayer`.
    - In `src/components/map/MapView.tsx` (lines 545–571), `HiResTerrainLayer` is instantiated:
      ```tsx
      new HiResTerrainLayer({
        id: `terrain-world-${view.basemap}-${view.showRoads ? 'r' : 'nr'}-${terrainWorker ? 'w' : 'm'}`,
        elevationData: TERRARIUM_URL,
        texture,
        ...
        extensions: [haze, FLOOD_TERRAIN],
      })
      ```
    - Check `src/components/map/hiResTerrain.ts`:
      - Look at how `HiResTerrainLayer` builds elevation meshes. Does `TERRARIUM_URL` download properly, or is `TERRAIN_WORKER_URL` (`/workers/terrain-worker.js`) failing to mesh the tiles?
      - Look at fallback terrain: `else if (view.terrain3d && terrain && terrain.id === config.id)` uses scenario DEM `elevation.bin` via `TerrainLayer`.
      - Check if `FLOOD_TERRAIN` extension injection in `HiResTerrainLayer` or `meshMaxError` / bounding box is causing terrain tiles to fail silently or get discarded.

#### Issue 3: Water Simulation Not Visible in 3D View
- **Symptom:** In 2D, the flood water animates and renders with colors and contours. In 3D, no flood water is visible on the terrain.
- **Root Cause:**
  - Previously, 3D water was rendered via a dedicated `SimpleMeshLayer` (`flood-skin`) using `buildGridMesh(data.dem, data.grid, SKIN_LIFT, ...)` with `FLOOD` and `WaterExtension`.
  - Commit `683d71e` removed `flood-skin` and attempted to drape the flood inside the terrain shader (`fs:DECKGL_FILTER_COLOR` in `HiResTerrainLayer`).
  - Because `HiResTerrainLayer` is broken / not rendering, the flood water shader inside it also never renders!
  - **Solution for Claude:** Either restore the reliable `flood-skin` `SimpleMeshLayer` (which drapes the lifted scenario DEM with `FLOOD` + `WaterExtension` ripple/specular shaders), or fix `FLOOD_TERRAIN` in `HiResTerrainLayer` once 3D terrain elevation meshing is fixed.

---

## 2. Key Architecture Files

- `src/components/map/MapView.tsx`: Main map component hosting Deck.gl and MapLibre. All layers (`HiResTerrainLayer`, `TerrainLayer`, `BitmapLayer` for flood, `PathLayer` for roads and evacuation, markers, labels).
- `src/components/map/hiResTerrain.ts`: `HiResTerrainLayer`, tile queue, Terrarium elevation tile decoding and mesh creation.
- `src/components/map/floodGpu.ts`: `FloodExtension` deck.gl LayerExtension, GPU texture bindings (`flood_frames`, `flood_arrival`, `flood_lut`).
- `src/components/map/water.ts`: Water ripples, glints, and Fresnel reflections.
- `src/components/map/waterMesh.ts`: `buildGridMesh` generator for lifted 3D terrain flood skin mesh.
- `src/lib/evacuation.ts`: Evacuation route Dijkstra/A* routing on road networks and safe high-ground calculation.
- `src/store/simulationStore.ts`: Zustand store managing `viewState`, `basemap` (`'satellite' | 'light'`), `terrain3d` (boolean), `playhead`.

---

## 3. Verification Checklist for Claude
Before committing or claiming fixed:
1. `npm run verify` MUST PASS (tests SWE Godunov finite volume mass balance & SPH particles).
2. `npx tsc --noEmit -p .` MUST be 0 errors.
3. `npx eslint src` MUST be 0 errors, 0 warnings.
4. Boot the app (`npm run build && npx next start -p 3000` or `npm run dev`) and test visually:
   - On initial load, Satellite view MUST actually display satellite imagery, matching the toggle.
   - Switching between 2D and 3D MUST show 3D mountains with real elevation depth (not a black flat plane).
   - In 3D mode, the flood water simulation MUST be clearly visible flowing down the Bhagirathi gorge past Tehri and Devprayag.
   - Evacuation routes MUST remain bold, emerald green, and sit cleanly above ground.
