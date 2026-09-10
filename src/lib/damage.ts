// Hazard and loss models.
//
// Hazard to people and structures: the six combined depth–velocity classes H1–H6 of the
// Australian Institute for Disaster Resilience (Guideline 7-3, 2017), widely used for
// dam-break consequence assessment.
// Damage: JRC global flood depth–damage function for residential buildings in Asia
// (Huizinga, de Moel & Szewczyk, 2017), applied to indicative replacement values in rupees.
// Values are deliberately simple and editable; results are indicative, not a loss adjuster's.

export interface HazardClass {
  id: number;
  label: string;
  description: string;
}

export const HAZARD_CLASSES: HazardClass[] = [
  { id: 1, label: 'H1', description: 'Generally safe for people, vehicles and buildings' },
  { id: 2, label: 'H2', description: 'Unsafe for small vehicles' },
  { id: 3, label: 'H3', description: 'Unsafe for vehicles, children and the elderly' },
  { id: 4, label: 'H4', description: 'Unsafe for people and vehicles' },
  { id: 5, label: 'H5', description: 'Unsafe for people and vehicles; buildings need special engineering' },
  { id: 6, label: 'H6', description: 'Unsafe for all; all building types vulnerable to failure' },
];

/** Returns 0 for dry, otherwise the AIDR hazard class 1–6. */
export function hazardClass(depth: number, speed: number, depthVelocity: number): number {
  if (depth < 0.1) return 0;
  if (depth <= 0.3 && speed <= 2 && depthVelocity <= 0.3) return 1;
  if (depth <= 0.5 && speed <= 2 && depthVelocity <= 0.6) return 2;
  if (depth <= 1.2 && speed <= 2 && depthVelocity <= 0.6) return 3;
  if (depth <= 2 && speed <= 2 && depthVelocity <= 1) return 4;
  if (depth <= 4 && speed <= 4 && depthVelocity <= 4) return 5;
  return 6;
}

const JRC_DEPTH = [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6];
const JRC_ASIA_RESIDENTIAL = [0, 0.33, 0.49, 0.62, 0.72, 0.87, 0.93, 0.98, 1];

/** Fraction of value lost at a flood depth (m). */
export function damageFraction(depth: number): number {
  if (depth <= 0) return 0;
  if (depth >= 6) return 1;
  for (let i = 1; i < JRC_DEPTH.length; i++) {
    if (depth <= JRC_DEPTH[i]) {
      const f = (depth - JRC_DEPTH[i - 1]) / (JRC_DEPTH[i] - JRC_DEPTH[i - 1]);
      return JRC_ASIA_RESIDENTIAL[i - 1] + f * (JRC_ASIA_RESIDENTIAL[i] - JRC_ASIA_RESIDENTIAL[i - 1]);
    }
  }
  return 1;
}

/** Indicative replacement values (₹). */
export const VALUES = {
  householdSize: 4.8,
  /** Structure + contents per household. */
  perHousehold: 10_00_000,
  hospital: 25_00_00_000,
  school: 2_00_00_000,
  emergency: 5_00_00_000,
  bridge: 20_00_00_000,
  roadPerKm: { motorway: 20_00_00_000, trunk: 8_00_00_000, primary: 5_00_00_000, secondary: 2_00_00_000, tertiary: 80_00_000 } as Record<string, number>,
};

export function assetLoss(kind: string, population: number, depth: number, share: number, depthVelocity: number): number {
  if (depth < 0.1) return 0;
  const f = damageFraction(depth);
  switch (kind) {
    case 'settlement':
      return (population / VALUES.householdSize) * VALUES.perHousehold * f * Math.min(1, share);
    case 'hospital':
      return VALUES.hospital * f;
    case 'school':
      return VALUES.school * f;
    case 'emergency':
      return VALUES.emergency * f;
    case 'bridge':
      // Depth × velocity above ~2 m²/s with a metre of water is treated as a wash-out.
      return VALUES.bridge * (depthVelocity >= 2 && depth >= 1 ? 1 : 0.5 * f);
    default:
      return 0;
  }
}

export function roadLoss(highway: string, lengthM: number, depth: number): number {
  if (depth < 0.3) return 0;
  const perKm = VALUES.roadPerKm[highway] ?? VALUES.roadPerKm.tertiary;
  const f = Math.min(0.8, 0.15 + 0.25 * (depth - 0.3));
  return (lengthM / 1000) * perKm * f;
}
