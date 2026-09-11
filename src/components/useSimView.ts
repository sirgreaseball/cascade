'use client';

// Derived, memoised views over the frame store for the panels and the map.

import { useMemo } from 'react';
import { useSimStore } from '@/store/simulationStore';
import type { EngineView } from '@/store/simulationStore';
import { useScenarioStore } from '@/store/scenarioStore';
import { results } from '@/simulation/results';
import type { EngineId } from '@/simulation/types';
import { assessAssets, summarizeImpacts } from '@/lib/analytics';
import type { AssetStatus, ImpactSummary } from '@/lib/analytics';

/**
 * Engine that drives KPIs and single-engine layers: the one the view asks for, unless it has
 * no frames yet and the other one does (so the map never goes blank while SPH catches up).
 */
export function primaryEngine(view: EngineView, engines: Record<EngineId, boolean>, frames?: Record<EngineId, number>): EngineId {
  const want: EngineId = view === 'sph' && engines.sph ? 'sph' : engines.swe ? 'swe' : 'sph';
  if (frames && frames[want] === 0) {
    const other: EngineId = want === 'swe' ? 'sph' : 'swe';
    if (frames[other] > 0) return other;
  }
  return want;
}

export function usePrimaryEngine(): EngineId {
  return useSimStore((s) => primaryEngine(s.view.engine, s.engines, { swe: s.runs.swe.frames, sph: s.runs.sph.frames }));
}

/**
 * Latest simulated time of the results on screen: the engine the map shows (both, in the overlay
 * view). Following the fastest engine instead ran the clock past the last frame of the water
 * being drawn, so the map showed a stale or empty flood while time moved on.
 */
export function latestTime(): number {
  const s = useSimStore.getState();
  if (s.view.engine === 'overlay' && s.engines.swe && s.engines.sph) return Math.min(results.latestTime('swe'), results.latestTime('sph'));
  return results.latestTime(primaryEngine(s.view.engine, s.engines, { swe: s.runs.swe.frames, sph: s.runs.sph.frames }));
}

export function useLatestTime(): number {
  return useSimStore((s) => {
    void s.resultsVersion;
    return latestTime();
  });
}

/** Frame index at or before the playhead for an engine (−1 before the first frame). */
export function useFrameIndex(engine: EngineId): number {
  return useSimStore((s) => {
    void s.resultsVersion;
    const loc = results.locate(engine, s.playhead);
    return loc ? loc.i0 : -1;
  });
}

export interface ImpactView {
  engine: EngineId;
  frameIndex: number;
  t: number;
  statuses: AssetStatus[];
  impact: ImpactSummary;
  floodedArea: number;
  inflowRate: number;
  released: number;
  /** Volume that has flowed out through the study-area edge (m³). */
  leftArea: number;
}

// The map, the impact panel and the places list all read the same assessment; compute it once
// per (engine, frame, summary) and share it.
let impactCache: { key: string; exposure: unknown; value: ImpactView | null } | null = null;

function computeImpacts(engine: EngineId, frameIndex: number, exposure: ReturnType<typeof useScenarioStore.getState>['exposure']): ImpactView | null {
  const r = results.get(engine);
  if (!r || frameIndex < 0 || !exposure || r.exposure.length <= frameIndex) return null;
  const key = `${engine}:${frameIndex}:${r.exposure.length > frameIndex ? 1 : 0}:${r.summary?.t ?? -1}`;
  if (impactCache && impactCache.key === key && impactCache.exposure === exposure) return impactCache.value;
  const statuses = assessAssets(exposure, r.exposure, r.times, frameIndex, r.summary);
  const impact = summarizeImpacts(exposure, statuses, r.exposure[frameIndex]);
  const stats = r.stats[frameIndex];
  const value: ImpactView = {
    engine,
    frameIndex,
    t: r.times[frameIndex],
    statuses,
    impact,
    floodedArea: stats.wetArea,
    inflowRate: stats.inflowRate,
    released: stats.inflowVolume,
    leftArea: stats.outflowVolume,
  };
  impactCache = { key, exposure, value };
  return value;
}

export function useImpacts(engine: EngineId): ImpactView | null {
  const frameIndex = useFrameIndex(engine);
  // Re-assess only when a new summary lands, not on every frame message.
  const summaryT = useSimStore((s) => {
    void s.resultsVersion;
    return results.get(engine)?.summary?.t ?? -1;
  });
  const exposure = useScenarioStore((s) => s.exposure);
  return useMemo(() => computeImpacts(engine, frameIndex, exposure), [engine, frameIndex, summaryT, exposure]);
}
