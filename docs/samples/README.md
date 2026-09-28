# Sample files to import

Files for exercising every import Cascade offers. They are built around the **Tehri** scenario, so
load that first (it is the default) and the coordinates will line up.

Everything here is **synthetic test data**, generated from the scenario's own terrain. The observed
extent is not a real Sentinel-1 observation and the depth raster is not a real Delft3D run; they are
shaped like those exports so the import paths can be tried without waiting on a satellite.

---

## Your own data — Event tab → *Your own data* → **Import a spreadsheet**

Accepts `.xlsx`, `.csv`, `.tsv`. Columns are matched by their headings, so sheet names and column
order do not matter, and units are read from the heading.

| File | What it carries | What you should see |
|---|---|---|
| `tehri-all-three.xlsx` | all three datasets, one sheet each | hydrograph, dam figures and 6 settlements in one go |
| `gauge-record.xlsx` | one sheet, a modest gauge record in hours and cumecs | peak 26,700 m³/s at 3 h — a far smaller event than the breach |
| `hydrograph-minutes.csv` | time in minutes, discharge in m³/s | peak 590,000 m³/s at 0.75 h, 4566 Mm³ |
| `hydrograph-hours-cusecs.csv` | the *same event* in hours and cubic feet per second | **identical figures** — the heading decides the units |
| `hydrograph.tsv` | the same again, tab separated, column headed just `Q` | identical figures |
| `dam-parameters.csv` | all six dam settings | the Event tab's figures change to match |
| `dam-parameters-partial.csv` | only breach width, formation time and roughness | those three change, everything else is left alone |
| `settlements.csv` | four places, tidy | 4 read, all inside the area |
| `settlements-messy.csv` | headed `Village Name / y / x / Residents`, with a `102,138` thousands separator, a blank coordinate, a quoted name containing a comma, and Bengaluru | **4 read, 1 skipped** for the blank coordinate; Bengaluru is then dropped as outside the study area |

Importing a hydrograph **replaces the breach calculation** — the section retitles itself *Imported
hydrograph* and the solver routes your record instead of computing one. Remove it with the ✕ to get
the modelled breach back.

`settlements-messy.csv` is the interesting one: it is deliberately awkward, and it is what proves a
blank latitude is skipped rather than read as `0` and placed in the Gulf of Guinea.

## Observed flood extent — Observe tab → **Observed flood extent**

Accepts `.geojson`, `.json`, `.kml`, `.tif`.

| File | What you should see |
|---|---|
| `observed-extent.geojson` | 1 polygon, **53.3 km²** — a 1.2 km corridor down the Bhagirathi. Draws on the map, and once a run has finished, scores it: agreement (CSI), detected %, false alarm % |

This is the shape a Google Earth Engine export takes. To make a real one, use **Observe →
Near-real-time flood mapping → Copy script**, run it in the Earth Engine Code Editor, and import
the GeoJSON it writes to your Drive.

## Another model's result — Model tab → **Compare runs**

Accepts `.tif`, `.asc`.

| File | What you should see |
|---|---|
| `max-depth-delft3d.asc` | WGS 84, 220 × 200 px, **29.7 km² wet, deepest 38.0 m** — compares depth cell by cell against your run |

It is deliberately on a **coarser grid than the model** (0.002°, square in degrees, where Cascade's
cells are square in metres), because a real Delft3D or HEC-RAS export would be — so importing it
exercises the resampling rather than lining up conveniently.

---

Every file here is checked against the real importers; see the `Dataset import` block in
`npm run verify` for the cases they cover.
