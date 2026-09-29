// The reservoirs either side of a failure, read from the run on screen.
//
// Upstream: how far the breached reservoir has drained. The volume the run has released comes off
// the stored volume, and the level follows from the same stage–storage law the breach routing uses
// (V = V0 (d / d0)^m, d measured from the dam's base), so the level shown is the level that drove the
// outflow, standing on the dam's own bed in the model.
//
// Downstream, for a cascade such as Tehri → Koteshwar: the model's water surface at the next dam,
// against that dam's normal pool and crest. SRTM was flown in February 2000, before Koteshwar's
// reservoir existed, so the reservoir itself is not in the terrain; its normal pool is taken as a
// floor under the flood surface the model computes there, and the verdict is whether that surface
// reaches the crest. Its pool would add a little more water than the model routes — 88 Mm³ against
// the 3.5 km³ a full Tehri breach releases.

import type { CascadingDamInfo } from './scenario.ts';
import type { FrameStats } from '@/simulation/types.ts';

export interface UpstreamReservoirState {
  initialVolume: number;
  remainingVolume: number;
  releasedVolume: number;
  fractionDrained: number;
  /** Water level (m above sea level) now, and when the run began. */
  level: number;
  initialLevel: number;
  outflowRate: number;
}

export interface CascadingDamState {
  name: string;
  type: string;
  normalPoolElev: number;
  crestElev: number;
  spillwayCapacity: number;
  /** Water level at the dam (m above sea level): the normal pool, or the flood surface above it. */
  waterElev: number;
  /** How far the water stands above the normal pool (m). */
  surcharge: number;
  arrived: boolean;
  arrivalTimeS: number | null;
  spillwayDischarge: number;
  overtopped: boolean;
  overtoppingDischarge: number;
  status: 'normal' | 'surcharged' | 'critical' | 'overtopping';
  statusText: string;
}

/** Where the breached reservoir stands, given what the run has released so far. */
export function reservoirDrainage(
  reservoir: { volume: number; waterDepth: number; storageExponent: number; bedElevation: number },
  stats: FrameStats | null,
): UpstreamReservoirState {
  const released = Math.min(reservoir.volume, Math.max(0, stats?.inflowVolume ?? 0));
  const remaining = Math.max(0, reservoir.volume - released);
  const m = Math.max(reservoir.storageExponent, 1);
  const depth = reservoir.volume > 0 ? reservoir.waterDepth * (remaining / reservoir.volume) ** (1 / m) : 0;
  return {
    initialVolume: reservoir.volume,
    remainingVolume: remaining,
    releasedVolume: released,
    fractionDrained: reservoir.volume > 0 ? released / reservoir.volume : 0,
    level: reservoir.bedElevation + depth,
    initialLevel: reservoir.bedElevation + reservoir.waterDepth,
    outflowRate: stats?.inflowRate ?? 0,
  };
}

/**
 * A downstream dam under the flood. `groundElev` is the terrain at the dam in the model and
 * `floodDepth` the model's depth there now; together they are the flood's surface.
 */
export function cascadingDamState(dam: CascadingDamInfo, groundElev: number, floodDepth: number, arrivalS: number | null): CascadingDamState {
  const normalPoolElev = dam.normalPoolElev ?? groundElev + (dam.waterDepth ?? dam.height * 0.9);
  const crestElev = dam.crestElev ?? normalPoolElev + dam.height * 0.1;
  const spillwayCapacity = dam.spillwayCapacity ?? 0;
  const arrived = floodDepth >= 0.1;
  const waterElev = arrived ? Math.max(normalPoolElev, groundElev + floodDepth) : normalPoolElev;
  const surcharge = waterElev - normalPoolElev;
  const overtopped = waterElev > crestElev;
  const over = Math.max(0, waterElev - crestElev);
  // Broad-crested weir over the crest; the spillway passes the surcharge up to its rated capacity.
  const overtoppingDischarge = overtopped ? 1.7 * dam.crestLength * over ** 1.5 : 0;
  const spillwayDischarge = surcharge > 0 ? Math.min(spillwayCapacity, 2.1 * dam.crestLength * 0.4 * surcharge ** 1.5) : 0;

  let status: CascadingDamState['status'] = 'normal';
  let statusText = 'At its normal pool: the flood has not reached it.';
  if (overtopped) {
    status = 'overtopping';
    statusText = `The flood stands ${over.toFixed(1)} m over the crest. A dam overtopped like this is at real risk of failing in turn.`;
  } else if (arrived && crestElev - waterElev <= 2) {
    status = 'critical';
    statusText = `${(crestElev - waterElev).toFixed(1)} m below the crest.`;
  } else if (arrived) {
    status = 'surcharged';
    statusText = `Above its normal pool; the spillway passes what it can.`;
  }

  return {
    name: dam.name,
    type: dam.type ?? 'Dam',
    normalPoolElev,
    crestElev,
    spillwayCapacity,
    waterElev,
    surcharge,
    arrived,
    arrivalTimeS: arrivalS,
    spillwayDischarge,
    overtopped,
    overtoppingDischarge,
    status,
    statusText,
  };
}
