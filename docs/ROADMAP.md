# Roadmap

Where Cascade goes after the hackathon. It stays what it is now — a browser application with no
server, whose results can be checked — and grows in the directions a district control room or an
exercise planner would push it. Updated 29 September 2026; what exists today is in
`docs/ARCHITECTURE.md` and `docs/TASKS.md`.

## 1. Solver

- **Choose the solver on the whole run, not its first half-minute.** On a discrete GPU the WebGPU
  solver finishes a Tehri run 1.2–1.8× faster than the processor but loses the opening race, which
  samples the flood at its smallest. Race a later or longer slice, or choose by adapter class, after
  confirming the two agree run for run.
- **Roughness from land cover.** `src/lib/landcover.ts` already turns OpenStreetMap land use into a
  Manning coefficient per cell (Chow, 1959), and the solvers accept a roughness grid; it needs a
  switch in the Model tab and a validation run.
- **Cascading failure inside the solver.** Today a downstream dam (Koteshwar below Tehri) is read
  off the flood surface; route the flood through its reservoir and let it breach in turn.
- **Channels the DEM cannot see.** Burn river bathymetry into the grid where it is known, and
  accept finer DEMs (CartoDEM, local surveys) through the builder, which already reads GeoTIFF and
  ASCII.

## 2. Data

- **Every dam in India.** Merge the CWC National Register of Large Dams (attributes) with
  OpenStreetMap (positions) into the bundled catalogue — `scripts/build-national-catalogue.ts` and
  `scripts/fetch-osm-dams.ts` exist — so dam search works offline and on networks that block
  OpenStreetMap.
- **Exposure that knows its sources.** Census population for settlements where OpenStreetMap has
  none, instead of a typical value for the place type.

## 3. Validation

- **More events that happened**: Kedarnath / Chorabari 2013, and South Lhonak 2023, which destroyed
  the Teesta-III dam — each with recorded arrivals and depths, as Machchhu II carries today.
- **Real satellite checks**: run the Earth Engine script for Rishi Ganga 2021 and every future
  event, and keep the observed extents beside the scenarios.

## 4. Use in operations

- **Offline first**: installable, with the scenario's tiles cached, for a control room without a
  reliable link.
- **Warnings that go somewhere**: the CAP 1.2 export is already SACHET-shaped; wire it to an
  issuing workflow with review.
- **Shareable scenarios**: a link that opens a scenario with its settings, alongside today's
  scenario file.
- **Hindi and regional languages** across the interface, not only in the CAP alert.

## 5. Performance

- **60 fps while a run plays on a discrete GPU**, measured as map redraws (`mapframes.cjs`), not
  page frames.
- **Less on the main thread**: sample exposure in the solver's worker, and build the evacuation
  graph there too.
