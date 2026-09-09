import * as turf from '@turf/turf';

export interface InfrastructureFeature {
  type: string;
  id: string;
  geometry: any;
  properties: {
    type: 'building' | 'road' | 'bridge';
    name?: string;
    population?: number;
  };
}

export function calculateImpact(
  floodedPoints: [number, number][],
  infrastructure: any
) {
  if (floodedPoints.length === 0) {
    return {
      buildingsAffected: 0,
      roadsAffected: 0,
      populationAtRisk: 0,
    };
  }

  // Create a FeatureCollection of points
  const points = turf.featureCollection(
    floodedPoints.map(p => turf.point(p))
  );

  let buildingsAffected = 0;
  let roadsAffected = 0;
  let populationAtRisk = 0;

  // Since turf.intersect is for polygon/polygon, 
  // and we have points, we can use pointsWithinPolygon for buildings
  // For roads (lines), we can buffer the points or just check distance
  // But a simpler, faster approximation for the demo is to create a 
  // convex hull around the flooded points, and intersect that with infrastructure.

  let floodPolygon: any = null;
  if (floodedPoints.length > 2) {
    floodPolygon = turf.convex(points);
  } else {
    // Too few points for convex hull, just buffer them
    const buffered = floodedPoints.map(p => turf.buffer(turf.point(p), 0.05, {units: 'kilometers'}));
    floodPolygon = turf.featureCollection(buffered as any);
  }

  if (floodPolygon) {
    turf.featureEach(infrastructure, (feature) => {
      const type = feature.properties?.type;
      let isHit = false;

      // In a real app, do precise boolean overlap.
      // For performance in demo, check if feature center is in polygon
      const center = turf.center(feature);
      if (turf.booleanPointInPolygon(center, floodPolygon)) {
        isHit = true;
      }

      if (isHit) {
        if (type === 'building') {
          buildingsAffected++;
          populationAtRisk += (feature.properties?.population || 4); // Avg 4 people per building
        } else if (type === 'road' || type === 'bridge') {
          roadsAffected++;
        }
      }
    });
  }

  return {
    buildingsAffected,
    roadsAffected,
    populationAtRisk,
  };
}
