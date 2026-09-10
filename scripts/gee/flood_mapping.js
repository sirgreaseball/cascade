// Google Earth Engine (GEE) Script for Near Real-Time Flood Mapping
// Copy and paste this into the GEE Code Editor (https://code.earthengine.google.com/)

// Define the Area of Interest (AOI) - e.g., Tehri Dam downstream
var aoi = ee.Geometry.Polygon([
  [[78.2, 30.1], [78.6, 30.1], [78.6, 30.5], [78.2, 30.5]]
]);

// Set the event dates
var beforeStart = '2023-07-01';
var beforeEnd = '2023-07-15';
var afterStart = '2023-07-16';
var afterEnd = '2023-07-30';

// 1. Load Sentinel-1 GRD imagery
var collection = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(aoi)
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .select('VH');

// 2. Filter by date and create mosaics
var beforeImage = collection.filterDate(beforeStart, beforeEnd).mosaic().clip(aoi);
var afterImage = collection.filterDate(afterStart, afterEnd).mosaic().clip(aoi);

// Apply a smoothing filter to reduce radar speckle noise
var SMOOTHING_RADIUS = 30;
var beforeSmoothed = beforeImage.focal_median(SMOOTHING_RADIUS, 'circle', 'meters');
var afterSmoothed = afterImage.focal_median(SMOOTHING_RADIUS, 'circle', 'meters');

// 3. Water Classification (Otsu thresholding or simple threshold)
// Assuming water backscatter is very low (< -18 dB)
var WATER_THRESHOLD = -18; 
var beforeWater = beforeSmoothed.lt(WATER_THRESHOLD);
var afterWater = afterSmoothed.lt(WATER_THRESHOLD);

// 4. Identify flooded areas (Water in 'after' but not in 'before')
var flooded = afterWater.and(beforeWater.not());

// Mask out zero values so only flooded areas are rendered
var floodedMasked = flooded.updateMask(flooded.gt(0));

// 5. Visualization
Map.centerObject(aoi, 11);
Map.addLayer(beforeImage, {min: -25, max: 0}, 'Before Event (SAR)', false);
Map.addLayer(afterImage, {min: -25, max: 0}, 'After Event (SAR)', false);
Map.addLayer(afterWater.updateMask(afterWater.gt(0)), {palette: 'blue'}, 'Water Extent (After)', false);
Map.addLayer(floodedMasked, {palette: 'red'}, 'Flooded Areas (NRT)', true);

// 6. Export the result for CASCADE platform
Export.image.toDrive({
  image: floodedMasked,
  description: 'NRT_Flood_Extent',
  folder: 'CASCADE_Exports',
  scale: 30, // 30m resolution
  region: aoi,
  fileFormat: 'GeoTIFF'
});
