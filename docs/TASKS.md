# Tasks and status

What Cascade does today, what is still open, and what the submission needs. The engineering detail
behind each line — commits, measurements, the reasons — is in `docs/HANDOFF.md`. Updated
29 September 2026.

## Done

| Area | What works | Where |
|---|---|---|
| Physics | 2D shallow-water grid solver on the CPU and on WebGPU; SPH-SWE particle solver; Froehlich (2008) breach with level-pool routing against the live tailwater | `src/simulation/` |
| Events | Dam break, lake outburst (lake volume measured from the terrain), controlled release, cloudburst; seasons; imported hydrographs | Event tab |
| Scenarios | Tehri, Bhakra, Machchhu II 1979 (with recorded arrivals and depths), Rishi Ganga 2021; a builder for any dam or blockage in India | top bar |
| Impact | People exposed, arrival, depth, AIDR H1–H6 hazard, JRC loss, Graham loss of life with warning time, facilities, bridges, roads cut, places by arrival, evacuation routes that follow the clock | Impact panel, map |
| Two methods | Grid vs SPH: Grid / SPH / Both view, Difference layer, critical success index; one-click SPH check after a grid run | top bar, Impact panel |
| Uncertainty | 12-run ensemble and the Chance layer | Model tab |
| Validation | Live analytical benchmarks, mass balance of the run, comparison with another model's raster, the Machchhu historical check, reservoirs either side of the failure | Model, Observe, Event tabs |
| Satellite | Earth Engine Sentinel-1 script (UN-SPIDER), windows around the event for real failures; import of the observed extent and scoring | Observe tab |
| Data in | Spreadsheets (.xlsx / .csv / .tsv) with a hydrograph, dam figures or settlements; DEMs; exposure; scenario files | Event tab, builder |
| Data out | KML, Shapefile, GeoJSON, ASCII rasters, CSV evacuation list, one-page brief, CAP 1.2 alert (English and Hindi) | Export |
| Map | 3D terrain with imagery to about half a metre, detail chosen by measured bandwidth, flood drawn and animated on the GPU | `src/components/map/` |
| Site | Splash at `/`, simulator at `/dashboard`, deployed from `main` to https://trycascade.vercel.app | `frontend/`, `next.config.ts` |

## Open

- **Frame rate during a run on the GTX 1650.** Measured at 33 fps settling to 50 before the
  main-thread work was cut on 29 September (`781e62a`–`0ddde4b`); not re-measured since. The
  figure to get is map redraws per second with `scripts/bench/mapframes.cjs`, old and new builds
  interleaved.
- **The WebGPU race.** It refuses the graphics card on every machine tested, yet over a whole
  Tehri run the card is 1.2× faster than the processor when paced for the map and 1.8× faster
  flat out. Decide: race over a later or longer slice, or choose by adapter class — and check GPU
  and CPU results agree (`gpucompare.cjs`) before changing who wins.
- **The dam catalogue holds 144 dams.** Any other dam is found by a live OpenStreetMap search in
  the builder, which fails on networks that block Overpass and Nominatim. `scripts/fetch-osm-dams.ts`
  can add every mapped dam in India; it needs a connection Overpass answers on, and has failed
  part-way on slow links.

## For the submission

1. Record the product video on a network that reaches Esri, AWS terrain tiles and OpenStreetMap
   (the university network blocks OpenStreetMap). Open each scenario once first so tiles are cached.
2. Record playback after a run has finished rather than the live run: replay is smooth, while a run
   shares the processor with the map.
3. For the two-methods story, switch SPH on (or use the Impact panel's button after a grid run) and
   show Both, the Difference layer and the CSI.
