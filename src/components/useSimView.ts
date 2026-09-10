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

/** Engine that drives KPIs and single-engine layers for a view setting. */
export function primaryEngine(view: EngineView, engines: Record<EngineId, boolean>): EngineId {
  if (view === 'sph' && engines.sph) return 'sph';
  if (engines.swe) return 'swe';
  return 'sph';
}

export function usePrimaryEngine(): EngineId {
  return useSimStore((s) => primaryEngine(s.view.engine, s.engines));
}

/** Latest simulated time any engine has produced. */
export function latestTime(): number {
  return Math.max(results.latestTime('swe'), results.latestTime('sph'));
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
}

export function useImpacts(engine: EngineId): ImpactView | null {
  const frameIndex = useFrameIndex(engine);
  const version = useSimStore((s) => s.resultsVersion);
  const exposure = useScenarioStore((s) => s.exposure);
  return useMemo(() => {
    void version;
    const r = results.get(engine);
    if (!r || frameIndex < 0 || !exposure || r.exposure.length <= frameIndex) return null;
    const statuses = assessAssets(exposure, r.exposure, r.times, frameIndex, r.summary);
    const impact = summarizeImpacts(exposure, statuses, r.exposure[frameIndex]);
    const stats = r.stats[frameIndex];
    return {
      engine,
      frameIndex,
      t: r.times[frameIndex],
      statuses,
      impact,
      floodedArea: stats.wetArea,
      inflowRate: stats.inflowRate,
      released: stats.inflowVolume,
    };
  }, [engine, frameIndex, version, exposure]);
}
