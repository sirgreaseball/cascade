// Utilities to calculate upstream reservoir draining and downstream cascading dam routing.
// For cascading systems like Tehri -> Koteshwar, tracks how the upstream reservoir drains
// through the breach, and how the downstream reservoir absorbs inflow, spills, or overtops.

import type { CascadingDamInfo, ScenarioConfig } from './scenario.ts';
import type { FrameStats } from '@/simulation/types.ts';

export interface UpstreamReservoirState {
  initialVolumeMCM: number;
  remainingVolumeMCM: number;
  releasedVolumeMCM: number;
  fractionDrained: number;
  currentLevelM: number;
  initialLevelM: number;
  bedElevationM: number;
  outflowRate: number;
}

export interface CascadingDamState {
  name: string;
  type: string;
  crestLength: number;
  height: number;
  volumeMCM: number;
  normalPoolElev: number;
  crestElev: number;
  spillwayCapacity: number;
  currentDepthM: number;
  currentWaterElev: number;
  arrived: boolean;
  arrivalTimeS: number | null;
  spillwayDischarge: number;
  overtopped: boolean;
  overtoppingDepthM: number;
  overtoppingDischarge: number;
  status: 'normal' | 'surcharged' | 'critical' | 'overtopping';
  statusText: string;
}

/**
 * Calculates the current draining state of the upstream reservoir.
 */
export function calculateReservoirDrainage(
  config: ScenarioConfig | null,
  currentStats: FrameStats | null,
  playheadS: number
): UpstreamReservoirState | null {
  if (!config || !config.dam) return null;

  const initialVolumeMCM = config.dam.volumeMCM || 200;
  const initialDepth = config.dam.waterDepth || config.dam.height * 0.95;
  const bedElev = config.dem.min ?? 500;
  const initialLevelM = bedElev + initialDepth;

  let releasedMCM = 0;
  let outflowRate = 0;

  if (currentStats) {
    releasedMCM = currentStats.inflowVolume / 1e6;
    outflowRate = currentStats.inflowRate;
  } else if (playheadS <= 0) {
    releasedMCM = 0;
    outflowRate = 0;
  }

  const remainingVolumeMCM = Math.max(0, initialVolumeMCM - releasedMCM);
  const fractionDrained = Math.min(1, Math.max(0, releasedMCM / Math.max(initialVolumeMCM, 0.1)));

  // Volume-elevation curve exponent m (assumed 2.0 for typical V-shaped valleys)
  const m = 2.0;
  const currentHead = initialDepth * (remainingVolumeMCM / Math.max(initialVolumeMCM, 0.1)) ** (1 / m);
  const currentLevelM = bedElev + Math.max(0, currentHead);

  return {
    initialVolumeMCM,
    remainingVolumeMCM,
    releasedVolumeMCM: Math.min(initialVolumeMCM, releasedMCM),
    fractionDrained,
    currentLevelM,
    initialLevelM,
    bedElevationM: bedElev,
    outflowRate,
  };
}

/**
 * Calculates the live state of a downstream cascading dam based on sampled water depth.
 */
export function calculateCascadingDamState(
  dam: CascadingDamInfo,
  floodDepthM: number,
  arrivalS: number | null
): CascadingDamState {
  const normalPoolElev = dam.normalPoolElev ?? 612;
  const crestElev = dam.crestElev ?? normalPoolElev + (dam.height ? dam.height * 0.1 : 6.5);
  const spillwayCapacity = dam.spillwayCapacity ?? 13240;
  const crestLength = dam.crestLength ?? 300;
  const depth = Math.max(0, floodDepthM);
  const currentWaterElev = normalPoolElev + depth;

  const arrived = depth >= 0.1;
  const overtopped = currentWaterElev > crestElev;
  const overtoppingDepthM = overtopped ? currentWaterElev - crestElev : 0;

  // Broad-crested weir equation for overtopping: Q = 1.7 * L * H^1.5
  const overtoppingDischarge = overtopped ? 1.7 * crestLength * Math.pow(overtoppingDepthM, 1.5) : 0;

  // Spillway routing: passes water as reservoir surcharges above normal pool
  let spillwayDischarge = 0;
  if (depth > 0) {
    const theoreticalSpill = 2.1 * (crestLength * 0.4) * Math.pow(depth, 1.5);
    spillwayDischarge = Math.min(spillwayCapacity, theoreticalSpill);
  }

  let status: CascadingDamState['status'] = 'normal';
  let statusText = 'Conservation pool level';

  if (overtopped) {
    status = 'overtopping';
    statusText = `Overtopping crest (+${overtoppingDepthM.toFixed(1)} m) · Severe cascading breach risk`;
  } else if (crestElev - currentWaterElev <= 2.0 && arrived) {
    status = 'critical';
    statusText = `Critical freeboard (${(crestElev - currentWaterElev).toFixed(1)} m remaining)`;
  } else if (arrived) {
    status = 'surcharged';
    statusText = `Surcharge absorbed · Spillway active (${Math.round(spillwayDischarge).toLocaleString()} m³/s)`;
  }

  return {
    name: dam.name,
    type: dam.type ?? 'Gravity dam',
    crestLength,
    height: dam.height,
    volumeMCM: dam.volumeMCM,
    normalPoolElev,
    crestElev,
    spillwayCapacity,
    currentDepthM: depth,
    currentWaterElev,
    arrived,
    arrivalTimeS: arrivalS,
    spillwayDischarge,
    overtopped,
    overtoppingDepthM,
    overtoppingDischarge,
    status,
    statusText,
  };
}
