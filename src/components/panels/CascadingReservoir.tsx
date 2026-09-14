'use client';

// Live monitoring of upstream reservoir drainage and downstream cascading dam routing.
// For cascading systems like Tehri -> Koteshwar, tracks how the upstream reservoir drains
// through the breach, and how the downstream reservoir absorbs inflow, spills, or overtops.

import React, { useMemo } from 'react';
import { useScenarioStore } from '@/store/scenarioStore';
import { useSimStore } from '@/store/simulationStore';
import { usePrimaryEngine } from '@/components/useSimView';
import { results } from '@/simulation/results';
import { calculateReservoirDrainage, calculateCascadingDamState } from '@/lib/cascading';
import type { CascadingDamState } from '@/lib/cascading';
import { Section, Tag, Progress } from '@/components/ui/primitives';
import { formatDischarge, formatDuration } from '@/lib/format';
import { lngLatToCell } from '@/lib/geo/grid';

export default function CascadingReservoir() {
  const config = useScenarioStore((s) => s.config);
  const playhead = useSimStore((s) => s.playhead);
  const version = useSimStore((s) => s.resultsVersion);
  const primary = usePrimaryEngine();

  // Upstream reservoir draining calculation
  const upstreamState = useMemo(() => {
    void version;
    const r = results.get(primary);
    const loc = results.locate(primary, playhead);
    const stats = r && loc ? r.stats[loc.i0] : null;
    return calculateReservoirDrainage(config, stats, playhead);
  }, [config, primary, playhead, version]);

  // Downstream cascading dams calculation
  const cascadingStates = useMemo<CascadingDamState[]>(() => {
    void version;
    if (!config || !config.cascadingDams || config.cascadingDams.length === 0) return [];
    const r = results.get(primary);
    const loc = results.locate(primary, playhead);
    if (!r || !loc) {
      return config.cascadingDams.map((dam) => calculateCascadingDamState(dam, 0, null));
    }

    const { cols, rows } = config.grid;
    const bbox = config.bbox;
    const gridGeom = {
      cols,
      rows,
      bbox,
      dx: config.cellSize,
      dy: config.cellSize,
      width: (bbox[2] - bbox[0]) * 111320,
      height: (bbox[3] - bbox[1]) * 110574,
      lngStep: (bbox[2] - bbox[0]) / (cols - 1),
      latStep: (bbox[3] - bbox[1]) / (rows - 1),
      cellArea: config.cellSize * config.cellSize,
    };

    const d0 = r.depth[loc.i0];
    const d1 = r.depth[loc.i1];
    const summary = r.summary;

    return config.cascadingDams.map((dam) => {
      const cell = lngLatToCell(gridGeom, dam.lng, dam.lat);
      let depthM = 0;
      let arrivalS: number | null = null;

      if (cell && cell.index < d0.length) {
        const v0 = d0[cell.index] / 100;
        const v1 = d1[cell.index] / 100;
        depthM = v0 + (v1 - v0) * loc.f;
        if (summary && summary.arrival[cell.index] >= 0) {
          arrivalS = summary.arrival[cell.index];
        }
      }

      return calculateCascadingDamState(dam, depthM, arrivalS);
    });
  }, [config, primary, playhead, version]);

  if (!upstreamState && cascadingStates.length === 0) return null;

  return (
    <Section
      title="Reservoirs & Cascading Dams"
      action={
        cascadingStates.some((d) => d.overtopped) ? (
          <Tag tone="warning">Overtopping Active</Tag>
        ) : cascadingStates.some((d) => d.arrived) ? (
          <Tag tone="accent">Cascade Engaged</Tag>
        ) : (
          <Tag tone="neutral">Reservoir Monitoring</Tag>
        )
      }
    >
      <div className="space-y-3">
        {upstreamState && (
          <div className="rounded-2xl bg-fill/70 p-3 space-y-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-medium text-ink">
                {config?.dam.reservoir || `${config?.dam.name} Reservoir`}
              </span>
              <span className="text-[11px] text-muted">
                {Math.round(upstreamState.fractionDrained * 100)}% drained
              </span>
            </div>

            <Progress
              value={upstreamState.fractionDrained}
              color="var(--color-accent)"
              className="h-1.5"
            />

            <div className="grid grid-cols-3 gap-2 pt-1">
              <div>
                <div className="text-[10.5px] text-muted">Pool level</div>
                <div className="text-[13px] font-semibold text-ink">
                  {upstreamState.currentLevelM.toFixed(1)} m
                </div>
                <div className="text-[10px] text-faint">
                  starts at {upstreamState.initialLevelM.toFixed(0)} m
                </div>
              </div>
              <div>
                <div className="text-[10.5px] text-muted">Storage</div>
                <div className="text-[13px] font-semibold text-ink">
                  {Math.round(upstreamState.remainingVolumeMCM).toLocaleString()} MCM
                </div>
                <div className="text-[10px] text-faint">
                  of {Math.round(upstreamState.initialVolumeMCM).toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-[10.5px] text-muted">Discharge</div>
                <div className="text-[13px] font-semibold text-ink">
                  {formatDischarge(upstreamState.outflowRate)}
                </div>
                <div className="text-[10px] text-faint">breach outflow</div>
              </div>
            </div>
          </div>
        )}

        {cascadingStates.map((dam) => (
          <div
            key={dam.name}
            className="rounded-2xl border border-white/[0.08] bg-fill/50 p-3 space-y-2.5"
          >
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <span className="text-[12.5px] font-medium text-ink">{dam.name}</span>
                <span className="block text-[11px] text-muted">
                  {dam.type} · Crest {dam.crestElev.toFixed(1)} m
                </span>
              </div>
              {dam.overtopped ? (
                <Tag tone="warning">Overtopping Crest</Tag>
              ) : dam.arrived ? (
                <Tag tone="accent">Spillway Active</Tag>
              ) : (
                <Tag tone="neutral">Holding Pool</Tag>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1 text-left">
              <div>
                <div className="text-[10.5px] text-muted">Water level</div>
                <div className="text-[13px] font-semibold text-ink">
                  {dam.currentWaterElev.toFixed(1)} m
                </div>
                <div className="text-[10px] text-faint">
                  pool {dam.normalPoolElev.toFixed(0)} m
                </div>
              </div>
              <div>
                <div className="text-[10.5px] text-muted">Surcharge</div>
                <div className="text-[13px] font-semibold text-ink">
                  +{dam.currentDepthM.toFixed(1)} m
                </div>
                <div className="text-[10px] text-faint">
                  {dam.arrivalTimeS ? `arrived at ${formatDuration(dam.arrivalTimeS)}` : 'awaiting front'}
                </div>
              </div>
              <div>
                <div className="text-[10.5px] text-muted">Spill / Outflow</div>
                <div className="text-[13px] font-semibold text-ink">
                  {formatDischarge(dam.spillwayDischarge + dam.overtoppingDischarge)}
                </div>
                <div className="text-[10px] text-faint">
                  cap {Math.round(dam.spillwayCapacity).toLocaleString()} m³/s
                </div>
              </div>
            </div>

            <p className="text-[11px] leading-snug text-muted">{dam.statusText}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
