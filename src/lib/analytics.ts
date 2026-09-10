import * as turf from '@turf/turf';
import { AlertItem } from '@/types';

export function runAnalytics(
  waterDepth: Float32Array,
  gridSize: number,
  bbox: [number, number, number, number],
  infrastructure: any,
  evacuation: any,
  previouslyFloodedIds: Set<string>,
  currentStep: number
) {
  let buildingsAffected = 0;
  let roadsAffected = 0;
  let populationAtRisk = 0;
  const newAlerts: AlertItem[] = [];
  const newlyFloodedIds = new Set<string>();

  const [minLng, minLat, maxLng, maxLat] = bbox;
  const lngStep = (maxLng - minLng) / gridSize;
  const latStep = (maxLat - minLat) / gridSize;

  const getDepthAt = (lng: number, lat: number) => {
    const x = Math.floor((lng - minLng) / lngStep);
    const y = Math.floor((maxLat - lat) / latStep);
    if (x >= 0 && x < gridSize && y >= 0 && y < gridSize) {
      return waterDepth[y * gridSize + x];
    }
    return 0;
  };

  if (infrastructure) {
    turf.featureEach(infrastructure, (feature) => {
      const type = feature.properties?.type;
      const id = feature.properties?.name || `asset-${Math.random()}`;
      let isHit = false;

      const center = turf.center(feature);
      const depth = getDepthAt(center.geometry.coordinates[0], center.geometry.coordinates[1]);

      if (depth > 0.5) {
        isHit = true;
      }

      if (isHit) {
        if (type === 'village' || type === 'building') {
          buildingsAffected++;
          populationAtRisk += (feature.properties?.population || 4);
        } else if (type === 'road' || type === 'bridge') {
          roadsAffected++;
        }

        if (!previouslyFloodedIds.has(id)) {
          newlyFloodedIds.add(id);
          newAlerts.push({
            id: `alert-${Date.now()}-${id}`,
            timestamp: currentStep,
            message: `${type.toUpperCase()} INUNDATED: ${id} (Depth: ${depth.toFixed(2)}m)`,
            severity: 'high'
          });
        }
      }
    });
  }

  if (evacuation) {
    turf.featureEach(evacuation, (feature) => {
      const id = feature.properties?.name || `evac-${Math.random()}`;
      if (feature.geometry.type === 'LineString') {
        const line = feature as any;
        const length = turf.length(line, { units: 'kilometers' });
        let floodedSegments = 0;
        
        // Sample every 100m
        for (let i = 0; i <= length; i += 0.1) {
          const pt = turf.along(line, i, { units: 'kilometers' });
          const depth = getDepthAt(pt.geometry.coordinates[0], pt.geometry.coordinates[1]);
          if (depth > 0.5) {
            floodedSegments++;
          }
        }

        if (floodedSegments > 2) {
          if (!previouslyFloodedIds.has(id)) {
            newlyFloodedIds.add(id);
            newAlerts.push({
              id: `alert-${Date.now()}-${id}`,
              timestamp: currentStep,
              message: `EVAC ROUTE BLOCKED: ${id}`,
              severity: 'high'
            });
          }
        }
      }
    });
  }

  return {
    impacts: { buildingsAffected, roadsAffected, populationAtRisk },
    newAlerts,
    newlyFloodedIds
  };
}
