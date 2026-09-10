import * as turf from '@turf/turf';
import tokml from 'tokml';
import shpWrite from 'shp-write';

export function generateInundationGeoJSON(
  waterDepth: Float32Array,
  gridSize: number,
  bbox: [number, number, number, number],
  newlyFloodedIds: Set<string>,
  infrastructure: any
) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const lngStep = (maxLng - minLng) / gridSize;
  const latStep = (maxLat - minLat) / gridSize;

  const floodedPoints: any[] = [];

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (waterDepth[y * gridSize + x] > 0.5) {
        const lng = minLng + x * lngStep;
        const lat = maxLat - y * latStep;
        floodedPoints.push(turf.point([lng, lat]));
      }
    }
  }

  const features: any[] = [];

  // Generate extent polygon
  if (floodedPoints.length > 2) {
    const pointsCollection = turf.featureCollection(floodedPoints);
    const hull = turf.convex(pointsCollection);
    if (hull) {
      hull.properties = {
        name: 'Inundation Extent',
        type: 'extent',
        description: 'Simulated flood extent'
      };
      features.push(hull);
    }
  }

  // Include affected infrastructure
  if (infrastructure) {
    turf.featureEach(infrastructure, (feature) => {
      const id = feature.properties?.name;
      if (id && newlyFloodedIds.has(id)) {
        features.push(feature);
      }
    });
  }

  return turf.featureCollection(features);
}

export function downloadKML(geojson: any, scenarioName: string) {
  const kmlString = tokml(geojson, {
    name: 'name',
    description: 'description'
  });
  
  const blob = new Blob([kmlString], { type: 'application/vnd.google-earth.kml+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cascade_${scenarioName}_export.kml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadShapefile(geojson: any, scenarioName: string) {
  const options = {
    folder: `cascade_${scenarioName}_shp`,
    types: {
      point: 'infrastructure',
      polygon: 'extent',
      line: 'evacuation'
    }
  };
  
  try {
    const buffer = await shpWrite.zip(geojson, options);
    const blob = new Blob([buffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cascade_${scenarioName}_export.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Failed to export shapefile:', err);
    alert('Shapefile export failed. Check console for details.');
  }
}
