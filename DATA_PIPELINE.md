# CASCADE Data Pipeline

This document outlines the data sources and processing pipelines used in the CASCADE platform.

## 1. Static Infrastructure Data (GeoJSON)
- **Source**: OpenStreetMap (OSM) via Overpass API / QGIS.
- **Processing**:
  - Downloaded OSM data for the Area of Interest (AOI).
  - Filtered points (Villages, Hospitals, Buildings) and lines (Roads, Bridges).
  - Merged into `infrastructure.geojson`.
  - Added population estimates as a property `population` to relevant points.

## 2. Evacuation Routes (GeoJSON)
- **Source**: Manual digitisation in QGIS or extracted primary roads from OSM.
- **Processing**:
  - Exported as `evacuation.geojson`.
  - Stored as `LineString` features.
  - Used in analytics to sample points and determine if a route is blocked.

## 3. Elevation Data (DEM)
- **Source**: SRTM 30m or ALOS PALSAR.
- **Processing**:
  - Downloaded GeoTIFF.
  - Clipped to AOI using GDAL (`gdalwarp`).
  - Converted to a raw binary Float32Array (`.bin`) format to be directly loaded into the browser's Memory/Worker.
  - Loaded into the simulation engine to define the terrain constraints.

## 4. Near Real-Time (NRT) Flood Mask (Google Earth Engine)
- **Source**: Sentinel-1 SAR imagery via GEE.
- **Pipeline**:
  1. GEE script (`scripts/gee/flood_mapping.js`) identifies flooded regions using backscatter thresholding (Otsu method).
  2. The script isolates water present *after* an event that was not present *before* the event.
  3. The resulting mask is exported.
  4. (Future) The platform polls a GEE API endpoint or Cloud Storage bucket to download this mask and overlay it in the browser, providing ground-truth data for comparison against the simulation.
