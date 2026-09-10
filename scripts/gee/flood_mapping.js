// Cascade · Near-real-time flood extent from Sentinel-1 SAR (Google Earth Engine Code Editor)
//
// This is the same script the dashboard generates in Observe → Copy script, shown here for the
// Tehri study area. The dashboard version fills in the study area and dates for the open scenario.
// Method: UN-SPIDER Recommended Practice (Sentinel-1 change detection), adapted:
//   post/pre VH backscatter ratio > threshold, minus permanent water (JRC Global Surface Water),
//   minus slopes > 5° (radar shadow), minus specks (< 8 connected pixels).
// Paste into https://code.earthengine.google.com/, press Run, then start the export tasks.
// Import the exported GeoJSON or GeoTIFF into Cascade → Observe → Import observed extent.

var aoi = ee.Geometry.Rectangle([78.22, 30.02, 78.66, 30.42]);
var before = ['2026-07-25', '2026-08-10'];
var after = ['2026-08-29', '2026-09-10'];
var polarization = 'VH';
var passDirection = 'DESCENDING';
var differenceThreshold = 1.25;

var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', polarization))
  .filter(ee.Filter.eq('orbitProperties_pass', passDirection))
  .filter(ee.Filter.eq('resolution_meters', 10))
  .filterBounds(aoi)
  .select(polarization);

var beforeCollection = s1.filterDate(before[0], before[1]);
var afterCollection = s1.filterDate(after[0], after[1]);
print('Sentinel-1 scenes before / after:', beforeCollection.size(), afterCollection.size());

var beforeImage = beforeCollection.mosaic().clip(aoi);
var afterImage = afterCollection.mosaic().clip(aoi);

var smoothingRadius = 50;
var beforeFiltered = beforeImage.focal_mean(smoothingRadius, 'circle', 'meters');
var afterFiltered = afterImage.focal_mean(smoothingRadius, 'circle', 'meters');
var difference = afterFiltered.divide(beforeFiltered);
var flooded = difference.gt(differenceThreshold).rename('flooded').selfMask();

var gsw = ee.Image('JRC/GSW1_4/GlobalSurfaceWater');
var permanentWater = gsw.select('seasonality').gte(10).unmask(0);
flooded = flooded.updateMask(permanentWater.not());
var slope = ee.Algorithms.Terrain(ee.Image('WWF/HydroSHEDS/03VFDEM')).select('slope');
flooded = flooded.updateMask(slope.lt(5));
flooded = flooded.updateMask(flooded.connectedPixelCount(8).gte(8));

var floodedArea = flooded.multiply(ee.Image.pixelArea()).reduceRegion({
  reducer: ee.Reducer.sum(), geometry: aoi, scale: 10, bestEffort: true, maxPixels: 1e10
});
print('Newly flooded area (km²):', ee.Number(floodedArea.get('flooded')).divide(1e6));

Map.centerObject(aoi, 11);
Map.addLayer(beforeFiltered, {min: -25, max: 0}, 'Before (VH, dB)', false);
Map.addLayer(afterFiltered, {min: -25, max: 0}, 'After (VH, dB)', false);
Map.addLayer(flooded, {palette: ['4a3aa7']}, 'Newly flooded (Sentinel-1)');

var vectors = flooded.reduceToVectors({
  geometry: aoi, scale: 20, geometryType: 'polygon', eightConnected: false,
  bestEffort: true, maxPixels: 1e10, tileScale: 4
});
Export.table.toDrive({collection: vectors, description: 'cascade_tehri_observed_flood', folder: 'Cascade', fileFormat: 'GeoJSON'});
Export.image.toDrive({
  image: flooded.unmask(0).toByte(), description: 'cascade_tehri_observed_mask', folder: 'Cascade',
  region: aoi, scale: 20, crs: 'EPSG:4326', fileFormat: 'GeoTIFF', maxPixels: 1e10
});
