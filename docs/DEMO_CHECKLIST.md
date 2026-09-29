# Demo checklist

## Before

- Use the live site, https://trycascade.vercel.app (front page) → **Enter command center** →
  `/dashboard`; or locally `npm run build` then `npx next start -p 3000`. Chrome, 100 % zoom, the
  window in front — a covered window stops drawing.
- Be on a network that reaches Esri imagery, AWS terrain tiles and OpenStreetMap (the university
  network blocks OpenStreetMap). Open each bundled scenario once so its tiles are cached.
- On a laptop with two GPUs, give Chrome the high-performance one (Windows Settings → System →
  Display → Graphics → Chrome → High performance), then restart it.
- Run `npm run verify` and keep the output handy for physics questions.

## Flow (about six minutes)

1. **Problem (30 s).** SIH26161: flash floods from dam failures and landslide lakes (Rishi Ganga
   2021, Kosi 2008); responders need to know where, when and how bad.
2. **Scenario (45 s).** Tehri Dam in 3D over its real SRTM terrain. Event tab: the breach is sized
   with Froehlich (2008); the outflow chart shows how much water leaves and when.
3. **Run (90 s).** Press Run simulation. The grid solver computes in a background worker while the
   flood wave runs down the Bhagirathi gorge. Point at the Impact panel filling in: people in
   flooded places, first place reached, bridges and roads cut, indicative loss, loss of life and
   what a warning saves.
4. **Evacuation view (45 s).** Places reached, sorted by arrival time; click one to fly to it. The
   routes turn from green to red as the water cuts them. Switch the map to Arrival, then Hazard
   (AIDR H1–H6).
5. **Two models (60 s).** In the Impact panel, **Run SPH alongside the grid solver**. Then the top
   bar's Grid / SPH / Both, the particles, the Difference layer and the critical success index.
   Delft3D or HEC-RAS results can be imported for the same comparison.
6. **Satellite check (45 s).** Observe tab: the Sentinel-1 Earth Engine script generated for this
   area (for Rishi Ganga, around 7 February 2021); importing the result scores the model against
   what happened. Machchhu II: the recorded arrival and depth at Morbi, checked against the run.
7. **Any river (30 s).** Dam name → *New scenario for any river…* → pick a dam from the catalogue or
   off the map; Cascade follows the river and fetches terrain and exposure.
8. **Output (30 s).** Export → KML opens in Google Earth, Shapefile in QGIS, the one-page brief
   prints, the CAP alert is ready for SACHET.

For a recording, play the flood back after the run has finished: replay is smooth, while a live run
shares the processor with the map.

## Likely questions

- **Is this Delft3D?** The grid solver solves the same 2D shallow-water equations Delft3D-FLOW
  solves in 2D mode, with a shock-capturing finite-volume scheme suited to steep dam-break flows;
  real Delft3D output can be imported and compared.
- **Why is the peak outflow higher than the regressions?** The routed value follows the chosen
  breach width and formation time; the Event tab shows the Froehlich and MacDonald–Langridge-Monopolis
  estimates alongside so the range is visible.
- **How accurate is the terrain?** SRTM at about 30 m, resampled to 60–110 m cells. Narrow gorges
  are smoothed; finer cells or a local DEM improve that.
- **Does it need a server?** No. Everything, including both solvers, runs in the browser; the site
  is static files on Vercel.
