# Data pipeline

## Scenario files

A scenario is `public/scenarios/<id>.json` plus `public/data/<id>/`:

| File | Contents |
|---|---|
| `elevation.bin` | DEM, headerless little-endian Float32, metres, `grid.cols × grid.rows` values, row 0 = north edge, west → east |
| `assets.geojson` | Points: settlements (with population), health, education and emergency facilities, bridges |
| `roads.geojson` | LineStrings: motorway / trunk / primary / secondary / tertiary roads |

Cell *(col, row)* covers longitudes `bbox[0] + col·Δλ … +Δλ` and latitudes `bbox[3] − row·Δφ … −Δφ`, with `Δλ = (bbox[2] − bbox[0]) / cols` and `Δφ = (bbox[3] − bbox[1]) / rows`.

Key fields in the JSON: `bbox`, `cellSize` (target metres), `grid`, `event` (`dam-break` · `lake-outburst` · `controlled-release`), `dam` (location, height, crest length, storage in million m³, water depth), and `defaults` (Manning n, simulated duration, optional breach width / formation time).

## Building bundled data

```bash
npm run data:build                 # every scenario in index.json
npm run data:build -- bhakra       # one scenario
```

The script (`scripts/build-scenario.ts`) uses the same code as the in-app builder:

1. Picks a grid for the bbox at `cellSize`.
2. Downloads Terrarium tiles (AWS Open Data Terrain Tiles, SRTM-derived in India) at the finest zoom whose pixels are at most half a cell, and box-filters every pixel inside each cell. Tiles are cached in `scripts/.cache/`.
3. Queries OpenStreetMap through Overpass for places, facilities, bridges and major roads. Places without a population tag get a typical value for their type and are flagged `populationEstimated`.
4. Writes the files above and records sources and dates in the scenario JSON.

## Your own data

- **DEM:** GeoTIFF or ESRI ASCII grid in WGS 84, WGS 84 / UTM or Web Mercator (SRTM, ASTER GDEM, CartoDEM from Bhuvan). Use the scenario builder's upload option.
- **Exposure:** GeoJSON points (a `name`, and a `population` or `type`/`amenity`/`place` property) and LineStrings for roads.
- **External model results:** a maximum-depth raster from Delft3D, HEC-RAS, TUFLOW etc. as GeoTIFF or `.asc` — Model → Compare with another model.
- **Satellite observations:** GeoJSON / KML polygons or a GeoTIFF mask — Observe → Import observed extent. `scripts/gee/nrt_flood.py` produces one from Sentinel-1.
