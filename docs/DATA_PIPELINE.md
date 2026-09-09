# Data Pipeline

This document explains how to prepare data for a new dam scenario. We use small, preprocessed files to keep the hackathon demo fast and the repository size small.

## 1. Elevation Data (DEM)
1. Download DEM data for the target region using ISRO Bhuvan or USGS EarthExplorer (e.g., SRTM 30m).
2. Open the DEM in QGIS.
3. Clip the raster to a bounding box extending downstream of the dam.
4. Downsample/Resample the raster to a `512x512` or `256x256` grid using `gdalwarp` or QGIS tools.
5. Export the raw float values to a binary file (`elevation.bin`) using the provided Python scripts in `scripts/`.
6. Place `elevation.bin` in `public/data/<scenario-name>/`.

## 2. Infrastructure Data (GeoJSON)
1. Use Overpass Turbo or QGIS to extract OpenStreetMap data for the clipped bounding box.
2. Filter for critical infrastructure:
   - `highway=*` (roads)
   - `amenity=hospital`
   - `place=village` or `place=town`
   - `bridge=yes`
3. Simplify the geometries (e.g., convert complex polygons to points or simplified lines) to reduce file size.
4. Add custom properties like `population`, `type`, and `name`.
5. Export as `infrastructure.geojson` and save in `public/data/<scenario-name>/`.

## 3. Evacuation Routes
1. Manually draw plausible evacuation routes in GeoJSON.io leading away from the river valley.
2. Export as `evacuation.geojson` and save in `public/data/<scenario-name>/`.

## 4. Scenario Configuration
1. Create `public/scenarios/<scenario-name>.json` matching the `Scenario` type interface.
2. Set the `breachPoint` coordinates based on the pixel index (x, y) of the dam wall in the `512x512` elevation grid.
