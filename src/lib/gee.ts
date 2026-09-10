// Near-real-time flood mapping with Google Earth Engine: generates a ready-to-run Code Editor
// script for the scenario's study area, following the UN-SPIDER Recommended Practice for
// Sentinel-1 SAR change detection (pre/post-event VH backscatter ratio, refined with the JRC
// Global Surface Water permanent-water mask, a HydroSHEDS slope mask and a connectivity filter).
// The exported GeoJSON / GeoTIFF is imported back into Cascade for validation.

export const GEE_CODE_EDITOR = 'https://code.earthengine.google.com/';

export interface GeeParams {
  scenarioId: string;
  scenarioName: string;
  bbox: [number, number, number, number];
  preStart: string;
  preEnd: string;
  postStart: string;
  postEnd: string;
  polarization: 'VH' | 'VV';
  pass: 'DESCENDING' | 'ASCENDING';
  /** Post/pre backscatter ratio above which a pixel is classed as newly flooded (UN-SPIDER: 1.25). */
  threshold: number;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Latest 12 days (one Sentinel-1 repeat cycle) against the same window a month earlier. */
export function defaultGeeDates(now = new Date()): Pick<GeeParams, 'preStart' | 'preEnd' | 'postStart' | 'postEnd'> {
  const day = 86_400_000;
  return {
    postStart: iso(new Date(now.getTime() - 12 * day)),
    postEnd: iso(now),
    preStart: iso(new Date(now.getTime() - 45 * day)),
    preEnd: iso(new Date(now.getTime() - 30 * day)),
  };
}

export function buildGeeScript(p: GeeParams): string {
  const [w, s, e, n] = p.bbox.map((v) => Number(v.toFixed(5)));
  const tag = p.scenarioId.replace(/[^a-z0-9]+/gi, '_');
  return `// Cascade · Near-real-time flood extent from Sentinel-1 SAR
// Study area: ${p.scenarioName}
// Method: UN-SPIDER Recommended Practice (change detection), adapted.
// Paste into ${GEE_CODE_EDITOR} and press Run, then start the tasks in the Tasks tab.
// Import the exported GeoJSON (or GeoTIFF) into Cascade → Observe → Import observed extent.

var aoi = ee.Geometry.Rectangle([${w}, ${s}, ${e}, ${n}]);
var before = ['${p.preStart}', '${p.preEnd}'];
var after = ['${p.postStart}', '${p.postEnd}'];
var polarization = '${p.polarization}';
var passDirection = '${p.pass}';
var differenceThreshold = ${p.threshold};

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
print('After-event acquisitions:', afterCollection.aggregate_array('system:time_start')
  .map(function (t) { return ee.Date(t).format('YYYY-MM-dd HH:mm'); }));

var beforeImage = beforeCollection.mosaic().clip(aoi);
var afterImage = afterCollection.mosaic().clip(aoi);

// Speckle reduction, then the post / pre backscatter ratio (water darkens radar returns).
var smoothingRadius = 50;
var beforeFiltered = beforeImage.focal_mean(smoothingRadius, 'circle', 'meters');
var afterFiltered = afterImage.focal_mean(smoothingRadius, 'circle', 'meters');
var difference = afterFiltered.divide(beforeFiltered);
var flooded = difference.gt(differenceThreshold).rename('flooded').selfMask();

// Refinement: drop permanent water (flooded > 10 months a year), steep slopes (> 5°) where
// radar shadow mimics water, and speckle (fewer than 8 connected pixels).
var gsw = ee.Image('JRC/GSW1_4/GlobalSurfaceWater');
var permanentWater = gsw.select('seasonality').gte(10).unmask(0);
flooded = flooded.updateMask(permanentWater.not());
var dem = ee.Image('WWF/HydroSHEDS/03VFDEM');
var slope = ee.Algorithms.Terrain(dem).select('slope');
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
Export.table.toDrive({
  collection: vectors, description: 'cascade_${tag}_observed_flood',
  folder: 'Cascade', fileFormat: 'GeoJSON'
});
Export.image.toDrive({
  image: flooded.unmask(0).toByte(), description: 'cascade_${tag}_observed_mask',
  folder: 'Cascade', region: aoi, scale: 20, crs: 'EPSG:4326', fileFormat: 'GeoTIFF', maxPixels: 1e10
});
`;
}
