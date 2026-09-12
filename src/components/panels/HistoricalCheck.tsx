'use client';

// Model against what was actually recorded. Scenarios that reconstruct a failure that happened
// carry the reported arrival times and depths in their configuration; this compares them with the
// run on screen and says plainly whether each falls inside the reported range. The caveats are
// shown with the numbers, never underneath a fold: a reconstruction on modern terrain from
// contemporary accounts is an order-of-magnitude check, not a calibration.

import React, { useMemo } from 'react';
import { useScenarioStore } from '@/store/scenarioStore';
import { usePrimaryEngine, useImpacts } from '@/components/useSimView';
import { Section, Tag } from '@/components/ui/primitives';
import { formatClock, formatDepth } from '@/lib/format';
import { displayName } from '@/lib/text';
import type { ObservationPoint } from '@/lib/scenario';

type Verdict = 'match' | 'outside' | 'unknown';

interface Row {
  point: ObservationPoint;
  found: boolean;
  arrival: number | null;
  depth: number | null;
  arrivalVerdict: Verdict;
  depthVerdict: Verdict;
}

const within = (v: number, range: [number, number]) => v >= range[0] && v <= range[1];

function Chip({ verdict }: { verdict: Verdict }) {
  if (verdict === 'unknown') return null;
  return <Tag tone={verdict === 'match' ? 'accent' : 'warning'}>{verdict === 'match' ? 'In range' : 'Outside'}</Tag>;
}

export default function HistoricalCheck() {
  const config = useScenarioStore((s) => s.config);
  const exposure = useScenarioStore((s) => s.exposure);
  const primary = usePrimaryEngine();
  const impacts = useImpacts(primary);
  const observations = config?.observations;

  const rows = useMemo<Row[]>(() => {
    if (!observations || !exposure) return [];
    return observations.points.map((point) => {
      const wanted = point.place.trim().toLowerCase();
      let index = exposure.assets.findIndex((a) => displayName(a.name).trim().toLowerCase() === wanted);
      if (index < 0) index = exposure.assets.findIndex((a) => displayName(a.name).toLowerCase().includes(wanted));
      const status = index >= 0 ? impacts?.statuses[index] : undefined;
      const arrival = status && status.arrival >= 0 ? status.arrival : null;
      const depth = status && status.maxDepth > 0 ? status.maxDepth : null;
      return {
        point,
        found: index >= 0,
        arrival,
        depth,
        arrivalVerdict: point.arrivalMin && arrival !== null ? (within(arrival / 60, point.arrivalMin) ? 'match' : 'outside') : 'unknown',
        depthVerdict: point.peakDepthM && depth !== null ? (within(depth, point.peakDepthM) ? 'match' : 'outside') : 'unknown',
      };
    });
  }, [observations, exposure, impacts]);

  if (!observations) return null;

  return (
    <Section title="Checked against what happened" action={<Tag>{observations.event}</Tag>}>
      <div className="divide-y divide-white/[0.08] rounded-2xl bg-fill/70 px-3">
        {rows.map((row) => (
          <div key={row.point.place} className="space-y-2 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] font-medium">
                {row.point.place}
                {row.point.distanceKm ? <span className="text-muted"> · {row.point.distanceKm} km downstream</span> : null}
              </span>
              {!row.found && <Tag tone="warning">Not in the map data</Tag>}
            </div>
            {row.point.arrivalMin && (
              <div className="tnum flex items-baseline justify-between gap-3 text-[12px]">
                <span className="text-ink-2">
                  Arrival · recorded {row.point.arrivalMin[0]}–{row.point.arrivalMin[1]} min
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium">{row.arrival !== null ? formatClock(row.arrival) : '—'}</span>
                  <Chip verdict={row.arrivalVerdict} />
                </span>
              </div>
            )}
            {row.point.peakDepthM && (
              <div className="tnum flex items-baseline justify-between gap-3 text-[12px]">
                <span className="text-ink-2">
                  Peak depth · recorded {row.point.peakDepthM[0]}–{row.point.peakDepthM[1]} m
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium">{row.depth !== null ? formatDepth(row.depth) : '—'}</span>
                  <Chip verdict={row.depthVerdict} />
                </span>
              </div>
            )}
            {row.point.note && <p className="text-[11px] leading-snug text-faint">{row.point.note}</p>}
          </div>
        ))}
      </div>
      {!impacts && <p className="text-[11.5px] text-muted">Run the simulation to compare it with the record.</p>}
      <p className="text-[11px] leading-snug text-muted">{observations.caveats}</p>
      <p className="text-[11px] leading-snug text-faint">{observations.sources}</p>
    </Section>
  );
}
