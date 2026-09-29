'use client';

// The reservoirs either side of the failure, as the run on screen leaves them: the breached
// reservoir draining, and — where the scenario lists one, as Tehri lists Koteshwar — the next dam
// down the valley taking the flood. The arithmetic and its assumptions are in lib/cascading.ts.

import React, { useMemo } from 'react';
import { useScenarioStore } from '@/store/scenarioStore';
import { useSimStore } from '@/store/simulationStore';
import { usePrimaryEngine } from '@/components/useSimView';
import { results } from '@/simulation/results';
import { cascadingDamState, reservoirDrainage } from '@/lib/cascading';
import type { CascadingDamState } from '@/lib/cascading';
import { Section, Tag, Progress } from '@/components/ui/primitives';
import { formatDischarge, formatDuration, formatNumber, formatVolume } from '@/lib/format';
import { lngLatToCell } from '@/lib/geo/grid';

const DAM_TAG: Record<CascadingDamState['status'], { label: string; tone: 'neutral' | 'accent' | 'warning' }> = {
  normal: { label: 'Holding', tone: 'neutral' },
  surcharged: { label: 'Spilling', tone: 'accent' },
  critical: { label: 'Near the crest', tone: 'warning' },
  overtopping: { label: 'Overtopping', tone: 'warning' },
};

export default function CascadingReservoir() {
  const config = useScenarioStore((s) => s.config);
  const data = useScenarioStore((s) => s.data);
  const event = useSimStore((s) => s.event);
  const setup = useSimStore((s) => s.setup);
  // Figures for reading, so a new value each simulated minute is plenty — the same step the
  // panels' charts use. Following the playhead itself recomputed this on every playback step.
  const playhead = useSimStore((s) => Math.round(s.playhead / 60) * 60);
  const version = useSimStore((s) => s.resultsVersion);
  const primary = usePrimaryEngine();

  // A storm has no reservoir to drain, and nothing upstream fails.
  const drains = !!event && event.kind !== 'cloudburst';

  const upstream = useMemo(() => {
    void version;
    if (!drains || !event || !setup) return null;
    const r = results.get(primary);
    const loc = results.locate(primary, playhead);
    const stats = r && loc ? r.stats[loc.i0] : null;
    return reservoirDrainage({ volume: event.volume, waterDepth: event.waterDepth, storageExponent: event.storageExponent, bedElevation: setup.site.bed.elevation }, stats);
  }, [drains, event, setup, primary, playhead, version]);

  const downstream = useMemo<CascadingDamState[]>(() => {
    void version;
    const dams = config?.cascadingDams;
    if (!dams || dams.length === 0 || !data) return [];
    const r = results.get(primary);
    const loc = results.locate(primary, playhead);
    return dams.map((dam) => {
      const cell = lngLatToCell(data.grid, dam.lng, dam.lat);
      const ground = cell ? data.dem[cell.index] : 0;
      if (!cell || !r || !loc) return cascadingDamState(dam, ground, 0, null);
      const d0 = r.depth[loc.i0][cell.index] / 100;
      const d1 = r.depth[loc.i1][cell.index] / 100;
      const arrival = r.summary && r.summary.arrival[cell.index] >= 0 ? r.summary.arrival[cell.index] : null;
      return cascadingDamState(dam, ground, d0 + (d1 - d0) * loc.f, arrival);
    });
  }, [config, data, primary, playhead, version]);

  if (!upstream && downstream.length === 0) return null;
  const reservoirName = config?.dam.reservoir || `${config?.dam.name} reservoir`;

  return (
    <Section
      title="Reservoirs"
      action={
        downstream.some((d) => d.overtopped) ? (
          <Tag tone="warning">Next dam overtopped</Tag>
        ) : downstream.some((d) => d.arrived) ? (
          <Tag tone="accent">Flood at the next dam</Tag>
        ) : (
          <Tag>Before and after</Tag>
        )
      }
    >
      <div className="space-y-3">
        {upstream && (
          <div className="space-y-2.5 rounded-2xl bg-fill/70 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-medium text-ink">{reservoirName}</span>
              <span className="tnum text-[11px] text-muted">{Math.round(upstream.fractionDrained * 100)}% drained</span>
            </div>
            <Progress value={upstream.fractionDrained} color="var(--color-accent)" className="h-1.5" />
            <div className="grid grid-cols-3 gap-2 pt-1">
              <div>
                <div className="text-[10.5px] text-muted">Water level</div>
                <div className="tnum text-[13px] font-semibold text-ink">{formatNumber(upstream.level, 0)} m</div>
                <div className="tnum text-[10px] text-faint">from {formatNumber(upstream.initialLevel, 0)} m</div>
              </div>
              <div>
                <div className="text-[10.5px] text-muted">Still held</div>
                <div className="tnum text-[13px] font-semibold text-ink">{formatVolume(upstream.remainingVolume)}</div>
                <div className="tnum text-[10px] text-faint">of {formatVolume(upstream.initialVolume)}</div>
              </div>
              <div>
                <div className="text-[10.5px] text-muted">Outflow</div>
                <div className="tnum text-[13px] font-semibold text-ink">{formatDischarge(upstream.outflowRate)}</div>
                <div className="text-[10px] text-faint">through the breach</div>
              </div>
            </div>
          </div>
        )}

        {downstream.map((dam) => (
          <div key={dam.name} className="space-y-2.5 rounded-2xl bg-fill/50 p-3 ring-1 ring-white/[0.08]">
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <span className="text-[12.5px] font-medium text-ink">{dam.name}</span>
                <span className="block text-[11px] text-muted">
                  Downstream · {dam.type.toLowerCase()} · crest {formatNumber(dam.crestElev, 1)} m
                </span>
              </div>
              <Tag tone={DAM_TAG[dam.status].tone}>{DAM_TAG[dam.status].label}</Tag>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1">
              <div>
                <div className="text-[10.5px] text-muted">Water level</div>
                <div className="tnum text-[13px] font-semibold text-ink">{formatNumber(dam.waterElev, 1)} m</div>
                <div className="tnum text-[10px] text-faint">pool {formatNumber(dam.normalPoolElev, 0)} m</div>
              </div>
              <div>
                <div className="text-[10.5px] text-muted">Above the pool</div>
                <div className="tnum text-[13px] font-semibold text-ink">+{formatNumber(dam.surcharge, 1)} m</div>
                <div className="text-[10px] text-faint">{dam.arrivalTimeS !== null ? `reached at ${formatDuration(dam.arrivalTimeS)}` : 'not reached yet'}</div>
              </div>
              <div>
                <div className="text-[10.5px] text-muted">Passing</div>
                <div className="tnum text-[13px] font-semibold text-ink">{formatDischarge(dam.spillwayDischarge + dam.overtoppingDischarge)}</div>
                <div className="tnum text-[10px] text-faint">spillway {formatNumber(dam.spillwayCapacity)} m³/s</div>
              </div>
            </div>
            <p className="text-[11px] leading-snug text-muted">{dam.statusText}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
