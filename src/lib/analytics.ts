import * as turf from '@turf/turf';
import { ImpactResult, AlertItem } from '@/types';
import { calculateEstimatedLoss } from './damage';

export function runAnalytics(
  waterDepth: Float32Array,
  gridSize: number,
  cellSize: number,
  bbox: [number, number, number, number],
  infrastructure: any,
  evacuationRoutes: any,
  previouslyFloodedIds: Set<string>,
  currentStep: number
): { impacts: ImpactResult, newAlerts: AlertItem[], newlyFloodedIds: Set<string> } {
  
  let buildingsAffected = 0;
  let roadsAffected = 0;
  let populationAtRisk = 0;
  let floodedCellCount = 0;
  const newAlerts: AlertItem[] = [];
  const newlyFloodedIds = new Set<string>();

  const [minLng, minLat, maxLng, maxLat] = bbox;
  const lngStep = (maxLng - minLng) / gridSize;
  const latStep = (maxLat - minLat) / gridSize;

  for (let i = 0; i < waterDepth.length; i++) {
    if (waterDepth[i] > 0.1) {
      floodedCellCount++;
    }
  }
  const inundatedArea = floodedCellCount * (cellSize * cellSize) / 1000000; // in km^2

  // 1. Process Point Infrastructure (Buildings, Hospitals, Villages)
  if (infrastructure && infrastructure.features) {
    for (const feature of infrastructure.features) {
      if (feature.geometry.type === 'Point') {
        const [lng, lat] = feature.geometry.coordinates;
        
        // Convert to grid coords
        const x = Math.floor((lng - minLng) / lngStep);
        const y = Math.floor((maxLat - lat) / latStep);
        
        if (x >= 0 && x < gridSize && y >= 0 && y < gridSize) {
          const depth = waterDepth[y * gridSize + x];
          const type = feature.properties.type || 'unknown';
          const name = feature.properties.name || 'Unknown Asset';
          const pop = feature.properties.population || 0;
          
          if (depth > 0.5) { // 0.5m threshold for impact
            if (type === 'village' || type === 'hospital' || type === 'building') {
              buildingsAffected++;
              populationAtRisk += pop;
            } else if (type === 'bridge' || type === 'road') {
              roadsAffected++;
            }

            const idStr = `${type}-${name}`;
            if (!previouslyFloodedIds.has(idStr) && !newlyFloodedIds.has(idStr)) {
              newlyFloodedIds.add(idStr);
              newAlerts.push({
                id: `alert-${Date.now()}-${idStr}`,
                timestamp: Date.now(),
                message: `CRITICAL: ${name} (${type}) has been inundated. Depth: ${depth.toFixed(2)}m`,
                severity: 'high'
              });
            }
          }
        }
      }
    }
  }

  // 2. Process LineString Evacuation Routes
  if (evacuationRoutes && evacuationRoutes.features) {
    for (const feature of evacuationRoutes.features) {
      if (feature.geometry.type === 'LineString') {
        const coords = feature.geometry.coordinates;
        let isFlooded = false;
        
        // Check points along the route
        for (const [lng, lat] of coords) {
          const x = Math.floor((lng - minLng) / lngStep);
          const y = Math.floor((maxLat - lat) / latStep);
          
          if (x >= 0 && x < gridSize && y >= 0 && y < gridSize) {
            if (waterDepth[y * gridSize + x] > 0.3) { // 0.3m blocks road
              isFlooded = true;
              break;
            }
          }
        }

        if (isFlooded) {
          roadsAffected++;
          const name = feature.properties?.name || 'Evacuation Route';
          const idStr = `route-${name}`;
          
          if (!previouslyFloodedIds.has(idStr) && !newlyFloodedIds.has(idStr)) {
            newlyFloodedIds.add(idStr);
            newAlerts.push({
              id: `alert-${Date.now()}-${idStr}`,
              timestamp: Date.now(),
              message: `WARNING: ${name} compromised by floodwaters.`,
              severity: 'medium'
            });
          }
        }
      }
    }
  }

  const estimatedLoss = calculateEstimatedLoss(buildingsAffected, roadsAffected, populationAtRisk);
  const timeToImpact = currentStep; // Using steps as proxy for time for now

  return {
    impacts: { buildingsAffected, roadsAffected, populationAtRisk, estimatedLoss, inundatedArea, timeToImpact },
    newAlerts,
    newlyFloodedIds
  };
}
