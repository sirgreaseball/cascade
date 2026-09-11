'use client';

import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useScenarioStore } from '@/store/scenarioStore';
import { useSimStore } from '@/store/simulationStore';
import { useUiStore } from '@/store/uiStore';
import { results } from '@/simulation/results';
import { usePrimaryEngine, useImpacts } from '@/components/useSimView';
import { Divider, Dot, Section, Segmented, Stat, Tag } from '@/components/ui/primitives';
import { LineChart } from '@/components/ui/charts';
import { HAZARD_COLORS, IDENTITY } from '@/components/map/colormaps';
import { extentAgreement, depthDifference } from '@/lib/compare';
import { formatArea, formatClock, formatCompact, formatDepth, formatDischarge, formatINR, formatNumber, formatVolume } from '@/lib/format';
import { cn } from '@/lib/utils';
import { displayName } from '@/lib/text';
import { lossOfLife } from '@/lib/analytics';
import type { AssetStatus } from '@/lib/analytics';

const WARNING_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: '0', label: 'At breach' },
  { value: '1800', label: '30 min early' },
  { value: '3600', label: '1 h early' },
];

/** Graham (1999) loss-of-life estimate, and what an earlier warning would change. */
function LifeLossCard({ statuses }: { statuses: AssetStatus[] }) {
  const exposure = useScenarioStore((s) => s.exposure);
  const [warning, setWarning] = useState('0');
  const lead = warning === 'none' ? -1 : Number(warning);
  const estimate = useMemo(() => (exposure ? lossOfLife(exposure, statuses, lead) : null), [exposure, statuses, lead]);
  const unwarned = useMemo(() => (exposure ? lossOfLife(exposure, statuses, -1) : null), [exposure, statuses]);
  if (!estimate || !unwarned) return null;
  const fmt = (v: number) => (v < 1 ? '< 1' : formatNumber(Math.round(v)));
  const saved = unwarned.central - estimate.central;
  const when = lead < 0 ? 'with no warning' : lead === 0 ? 'with the warning issued as the breach begins' : `with the warning issued ${lead / 60} min before the breach`;
  return (
    <div className="space-y-2.5 rounded-2xl bg-fill/70 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[12px] text-muted">Estimated loss of life</div>
        <div className="tnum text-[20px] font-semibold tracking-[-0.02em]">{fmt(estimate.central)}</div>
      </div>
      <div>
        <div className="mb-1 text-[11px] text-muted">Warning issued</div>
        <Segmented size="sm" layoutId="warning-lead" value={warning} onChange={(v: string) => setWarning(v)} options={WARNING_OPTIONS} />
      </div>
      <div className="text-[11px] leading-snug text-faint">
        Range {fmt(estimate.low)}–{fmt(estimate.high)}
        {lead >= 0 && saved >= 1 ? `; about ${formatNumber(Math.round(saved))} fewer than with no warning` : ''}. Graham (1999) fatality rates by flood severity and warning time, {when}.
      </div>
    </div>
  );
}

function HazardBadge({ level }: { level: number }) {
  if (!level) return <span className="text-[11px] text-faint">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-2">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: HAZARD_COLORS[level - 1] }} />H{level}
    </span>
  );
}

function ExposureOverview() {
  const exposure = useScenarioStore((s) => s.exposure);
  const config = useScenarioStore((s) => s.config);
  const stats = useMemo(() => {
    if (!exposure) return null;
    let people = 0;
    let settlements = 0;
    let health = 0;
    let schools = 0;
    let bridges = 0;
    for (const a of exposure.assets) {
      if (a.kind === 'settlement') {
        settlements++;
        people += a.population;
      } else if (a.kind === 'hospital') health++;
      else if (a.kind === 'school') schools++;
      else if (a.kind === 'bridge') bridges++;
    }
    const roadKm = exposure.roads.reduce((s, r) => s + r.lengthM, 0) / 1000;
    return { people, settlements, health, schools, bridges, roadKm };
  }, [exposure]);
  if (!stats) return null;
  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-fill/70 p-4">
        <div className="text-[13px] font-semibold">Run the simulation to see who is affected, when, and how badly.</div>
        <p className="mt-1 text-[12px] leading-snug text-muted">Press Run simulation below. Both solvers compute in the background while the flood plays out on the map.</p>
      </div>
      <Section title="In the study area">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Stat label="Settlements" value={formatNumber(stats.settlements)} sub={`~${formatCompact(stats.people)} people`} />
          <Stat label="Health facilities" value={formatNumber(stats.health)} />
          <Stat label="Schools & colleges" value={formatNumber(stats.schools)} />
          <Stat label="Road bridges" value={formatNumber(stats.bridges)} />
          <Stat label="Major roads" value={`${formatNumber(stats.roadKm)} km`} />
        </div>
        <p className="text-[11px] leading-snug text-faint">
          {config?.exposure.source ?? 'OpenStreetMap'}. Where OpenStreetMap has no population, typical values for the place type are used.
        </p>
      </Section>
    </div>
  );
}

function PlacesList() {
  const primary = usePrimaryEngine();
  const impacts = useImpacts(primary);
  const exposure = useScenarioStore((s) => s.exposure);
  const selected = useSimStore((s) => s.selectedAsset);
  const selectAsset = useSimStore((s) => s.selectAsset);
  const [all, setAll] = useState(false);
  const rows = useMemo(() => {
    if (!impacts || !exposure) return [];
    return impacts.statuses
      .map((s, i) => ({ s, a: exposure.assets[i], i }))
      .filter((r) => r.s.maxDepth >= 0.1 && r.s.arrival >= 0)
      .sort((x, y) => x.s.arrival - y.s.arrival);
  }, [impacts, exposure]);
  if (rows.length === 0) return <p className="text-[12px] text-muted">No mapped places have been reached yet.</p>;
  const shown = all ? rows : rows.slice(0, 12);
  return (
    <div>
      <div className="tnum grid grid-cols-[1fr_58px_52px_34px] gap-2 px-2 pb-1.5 text-[10.5px] font-medium text-faint">
        <span>Place</span>
        <span className="text-right">Arrives</span>
        <span className="text-right">Peak</span>
        <span className="text-right">Risk</span>
      </div>
      <div className="space-y-0.5">
        {shown.map(({ s, a, i }) => (
          <button
            key={a.id}
            onClick={() => selectAsset(i === selected ? null : i)}
            className={cn('tnum grid w-full grid-cols-[1fr_58px_52px_34px] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-white/[0.06]', i === selected && 'bg-accent/[0.08]')}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink">{displayName(a.name)}</span>
              <span className="block truncate text-[10.5px] text-muted">
                {a.kind === 'settlement' ? `${a.subtype} · ${formatCompact(s.peopleExposed)} people` : a.kind === 'bridge' ? 'bridge' : a.subtype.replace('_', ' ')}
              </span>
            </span>
            <span className="text-right text-ink-2">{formatClock(s.arrival)}</span>
            <span className="text-right text-ink-2">{formatDepth(s.maxDepth)}</span>
            <span className="text-right">
              <HazardBadge level={s.hazard} />
            </span>
          </button>
        ))}
      </div>
      {rows.length > 12 && (
        <button className="mt-2 px-2 text-[12px] font-medium text-accent" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

function Comparison() {
  const version = useSimStore((s) => s.resultsVersion);
  const duration = useSimStore((s) => s.duration);
  const playhead = useSimStore((s) => Math.round(s.playhead / 60) * 60);
  const cellArea = useScenarioStore((s) => s.data?.grid.cellArea ?? 1);
  const data = useMemo(() => {
    void version;
    const a = results.get('swe');
    const b = results.get('sph');
    if (!a?.summary || !b?.summary) return null;
    return {
      agreement: extentAgreement(a.summary.maxDepth, b.summary.maxDepth),
      diff: depthDifference(a.summary.maxDepth, b.summary.maxDepth),
      series: [
        { id: 'swe', label: 'Grid', color: IDENTITY.swe, points: a.times.map((t, i) => [t, a.stats[i].wetArea / 1e6] as [number, number]) },
        { id: 'sph', label: 'SPH', color: IDENTITY.sph, points: b.times.map((t, i) => [t, b.stats[i].wetArea / 1e6] as [number, number]) },
      ],
    };
  }, [version]);
  if (!data) return null;
  const { agreement: ag, diff } = data;
  return (
    <Section title="Grid vs SPH" action={<Tag>Peak extent</Tag>}>
      <div className="flex items-end gap-3">
        <div className="text-[34px] font-semibold leading-none tracking-[-0.03em]">{ag.csi.toFixed(2)}</div>
        <div className="pb-1 text-[11.5px] leading-snug text-muted">critical success index — share of the combined flooded area both solvers agree on</div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Stat label={<span className="flex items-center gap-1.5"><Dot color={IDENTITY.swe} />Grid floods</span>} value={formatArea(ag.a * cellArea)} />
        <Stat label={<span className="flex items-center gap-1.5"><Dot color={IDENTITY.sph} />SPH floods</span>} value={formatArea(ag.b * cellArea)} />
        <Stat label="Mean depth difference" value={formatDepth(diff.meanAbsolute)} sub={`SPH ${diff.meanSigned >= 0 ? 'deeper' : 'shallower'} on average`} />
        <Stat label="Extent ratio" value={`${ag.bias.toFixed(2)}×`} sub="SPH ÷ grid" />
      </div>
      <div>
        <div className="mb-1 text-[11.5px] text-muted">Flooded area (km²)</div>
        <LineChart series={data.series} xMax={duration} height={110} yFormat={(v) => formatNumber(v, v < 10 ? 1 : 0)} xFormat={(s) => `${(s / 3600).toFixed(s % 3600 ? 1 : 0)}h`} marker={playhead} />
      </div>
    </Section>
  );
}

export default function RightPanel() {
  const open = useUiStore((s) => s.rightOpen);
  const setOpen = useUiStore((s) => s.setRightOpen);
  const primary = usePrimaryEngine();
  const impacts = useImpacts(primary);
  const hasResults = useSimStore((s) => s.runs.swe.frames > 0 || s.runs.sph.frames > 0);
  const i = impacts?.impact;

  return (
    <>
      <AnimatePresence initial={false}>
        {open && (
          <motion.aside
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className="glass pointer-events-auto absolute bottom-4 right-4 top-[76px] z-20 flex w-[var(--right-w)] flex-col overflow-hidden rounded-panel shadow-panel"
          >
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <div>
                <div className="text-[15px] font-semibold tracking-[-0.01em]">Impact</div>
                <div className="text-[11.5px] text-muted">
                  {impacts ? (
                    <span className="flex items-center gap-1.5">
                      <Dot color={primary === 'swe' ? IDENTITY.swe : IDENTITY.sph} />
                      {primary === 'swe' ? 'Grid solver' : 'SPH solver'} · T+{formatClock(impacts.t)}
                    </span>
                  ) : (
                    'Downstream exposure'
                  )}
                </div>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Hide panel" className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-white/[0.08] hover:text-ink">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="scroll-soft flex-1 space-y-6 overflow-y-auto px-5 pb-6 pt-2">
              {!hasResults || !impacts || !i ? (
                <ExposureOverview />
              ) : (
                <>
                  <div>
                    <div className="text-[12px] text-muted">People in flooded places</div>
                    <div className="mt-0.5 text-[48px] font-semibold leading-none tracking-[-0.04em]">{formatCompact(i.peopleExposed)}</div>
                    <div className="mt-1.5 text-[12px] text-muted">
                      in {formatNumber(i.settlementsFlooded)} settlement{i.settlementsFlooded === 1 ? '' : 's'}
                      {i.firstArrivalPlace && (
                        <>
                          {' '}· first reached: <span className="font-medium text-ink">{displayName(i.firstArrivalPlace)}</span> at T+{formatClock(i.firstArrival ?? 0)}
                        </>
                      )}
                    </div>
                  </div>
                  {i.peopleExposed > 0 && <LifeLossCard statuses={impacts.statuses} />}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                    <Stat
                      label="Flooded now"
                      value={formatArea(impacts.floodedArea)}
                      sub={impacts.leftArea > 1e5 ? `${formatVolume(impacts.leftArea)} left the area` : undefined}
                    />
                    <Stat label="Outflow now" value={formatDischarge(impacts.inflowRate)} sub={`${formatVolume(impacts.released)} released`} />
                    <Stat label="Critical facilities" value={formatNumber(i.facilitiesFlooded)} sub="health, schools, emergency" />
                    <Stat label="Bridges" value={formatNumber(i.bridgesFlooded)} sub="under water" />
                    <Stat label="Major roads cut" value={`${formatNumber(i.roadKmCut, i.roadKmCut < 10 ? 1 : 0)} km`} sub="≥ 0.3 m deep" />
                    <Stat label="Indicative loss" value={formatINR(i.loss)} sub="JRC depth–damage" />
                  </div>
                  <Divider />
                  <Section title="Places reached, by arrival">
                    <PlacesList />
                  </Section>
                  <Comparison />
                </>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="glass pointer-events-auto absolute right-4 top-[76px] z-20 flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium shadow-float"
        >
          <ChevronLeft className="h-4 w-4" /> Impact
        </button>
      )}
    </>
  );
}
