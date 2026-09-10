# Data Pipeline Guide

This document outlines how the GIS engineer should prepare and export scenario data for Project CASCADE.

## 1. GeoJSON Infrastructure & Evacuation

Export `infrastructure.geojson` and `evacuation.geojson` as standard EPSG:4326 GeoJSON files. 
- Infrastructure must contain `Point` or `Polygon` features with a `type` property (`village`, `building`, `road`, `bridge`, `hospital`) and a `name` property.
- Evacuation must contain `LineString` features with a `name` property.

## 2. Digital Elevation Model (DEM) Binary Format

To guarantee 60 FPS zero-copy transfers between the browser main thread and the physics Web Worker, we use raw binary Float32 arrays for elevation data instead of parsing GeoTIFFs at runtime.

**File:** `public/data/<scenario-id>/elevation.bin`

### Binary Spec:
- **Format**: Headerless Raw Binary
- **Data Type**: 32-bit Float (Float32)
- **Byte Order (Endianness)**: Little-Endian
- **Elevation Units**: Meters
- **NoData Value**: `-9999.0` (or `NaN`)

### Grid & Bounding Box Alignment:
- The binary file must contain EXACTLY `gridSize * gridSize` float values (e.g., 256x256 = 65,536 floats = 262,144 bytes).
- **Row 0, Col 0** (the very first float in the file) corresponds to the **North-West** corner of the bounding box (`bbox[0], bbox[3]`).
- The grid is read in row-major order, sweeping West to East, North to South.

To convert a GeoTIFF to this exact format using GDAL:
```bash
gdal_translate -of ENVI -ot Float32 -outsize 256 256 input.tif output.bin
# (You may need to rename the resulting raw file to elevation.bin)
```
