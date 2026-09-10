# Demo checklist

## Before

- `npm run build && npm run start` on the demo machine; open `http://localhost:3000` in Chrome at 100% zoom.
- Open each bundled scenario once while online so satellite imagery is cached.
- Run `npm run verify` and keep the output handy for physics questions.

## Flow (about six minutes)

1. **Problem (30 s).** SIH26161: flash floods from dam failures and landslide lakes (Rishi Ganga 2021, Kosi 2008); responders need to know where, when and how bad.
2. **Scenario (45 s).** Tehri Dam in 3D over its real SRTM terrain. Event tab: the breach is sized with Froehlich (2008); the outflow chart shows how much water leaves and when.
3. **Run (90 s).** Press Run simulation. Both solvers compute in background workers while the flood wave runs down the Bhagirathi gorge. Point at the Impact panel filling in: people in flooded places, first place reached, bridges and roads cut, indicative loss.
4. **Evacuation view (45 s).** Places reached, sorted by arrival time; click one to fly to it. Switch the map to Arrival, then Hazard (AIDR H1–H6).
5. **Two models (60 s).** Top bar: Grid / SPH / Both. Show the particles, the Difference layer and the critical success index. Mention that Delft3D or HEC-RAS results can be imported for the same comparison.
6. **Satellite check (45 s).** Observe tab: the Sentinel-1 Earth Engine script generated for this area; importing the result scores the model against reality.
7. **Any river (30 s).** New scenario → pick a dam from the catalogue → Cascade follows the river and fetches terrain and exposure.
8. **Output (30 s).** Export → KML opens in Google Earth, Shapefile in QGIS.

## Likely questions

- **Is this Delft3D?** The grid solver solves the same 2D shallow-water equations Delft3D-FLOW solves in 2D mode, with a shock-capturing finite-volume scheme suited to steep dam-break flows; real Delft3D output can be imported and compared.
- **Why is the peak outflow higher than the regressions?** The routed value follows the chosen breach width and formation time; the Event tab shows the Froehlich and MacDonald–Langridge-Monopolis estimates alongside so the range is visible.
- **How accurate is the terrain?** SRTM at about 30 m, resampled to 60–110 m cells. Narrow gorges are smoothed; finer cells or a local DEM improve that.
