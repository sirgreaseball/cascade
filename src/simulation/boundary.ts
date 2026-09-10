// The inflow boundary at the breach cells, shared by both solvers.
//  - Dam break / lake outburst: the reservoir is routed inside the solver. Each step it drains
//    through the breach under the current tailwater read from the 2D flow, so a drowned breach
//    passes less water (internal boundary coupling, as in HEC-RAS 2D).
//  - Controlled release: the prescribed hydrograph (gates pass a set discharge).

import { BreachReservoir, interpolateHydrograph } from './hydrograph.ts';
import type { EngineConfig } from './types.ts';

const G = 9.81;

export class InflowBoundary {
  lastRate = 0;
  private lastT = 0;
  private readonly reservoir: BreachReservoir | null;
  private readonly datum: number;
  private readonly baseFlow: number;
  private readonly hydrograph: EngineConfig['hydrograph'];

  constructor(cfg: EngineConfig) {
    this.hydrograph = cfg.hydrograph;
    if (cfg.breach) {
      this.reservoir = new BreachReservoir(cfg.breach.event);
      this.datum = cfg.breach.datumElevation;
      this.baseFlow = cfg.breach.event.baseFlow;
    } else {
      this.reservoir = null;
      this.datum = 0;
      this.baseFlow = 0;
    }
  }

  /** Outflow right now for a tailwater surface elevation (m a.s.l.), without advancing. */
  estimate(t: number, tailwaterElevation: number): number {
    if (!this.reservoir) return interpolateHydrograph(this.hydrograph, t);
    return this.reservoir.outflow(t, this.reservoir.volume, tailwaterElevation - this.datum) + this.baseFlow;
  }

  /** Mean inflow (m³/s) over [t, t + dt]; advances the reservoir. */
  step(t: number, dt: number, tailwaterElevation: number): number {
    const q = this.reservoir
      ? this.reservoir.advance(t, dt, tailwaterElevation - this.datum) + this.baseFlow
      : interpolateHydrograph(this.hydrograph, t + dt / 2);
    this.lastRate = q;
    this.lastT = t + dt;
    return q;
  }

  /**
   * Speed of water entering the grid: critical flow over the breach, v = √(g·⅔·head),
   * capped at 25 m/s; a gentle 3 m/s for gated releases.
   */
  jetVelocity(): number {
    if (!this.reservoir) return 3;
    return Math.min(Math.sqrt(G * (2 / 3) * this.reservoir.headOverInvert(this.lastT)), 25);
  }

  /** Reservoir level (m above the final invert), or null for releases. */
  get reservoirLevel(): number | null {
    return this.reservoir ? this.reservoir.level() : null;
  }
}
