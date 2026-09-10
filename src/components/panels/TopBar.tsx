'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Download, Plus, Trash2 } from 'lucide-react';
import { useScenarioStore } from '@/store/scenarioStore';
import { useSimStore } from '@/store/simulationStore';
import type { MapLayer } from '@/store/simulationStore';
import { useUiStore } from '@/store/uiStore';
import { Button, Segmented } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#1d1d1f" />
      <path d="M7 12.5c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.3-2 4.5-2 2.3 2 4.5 2" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M7 17c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.3-2 4.5-2 2.3 2 4.5 2" stroke="#fff" strokeOpacity="0.72" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M7 21.5c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.3-2 4.5-2 2.3 2 4.5 2" stroke="#fff" strokeOpacity="0.44" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

const EVENT_LABEL: Record<string, string> = {
  'dam-break': 'Dam break',
  'lake-outburst': 'Lake outburst',
  'controlled-release': 'Controlled release',
};

function ScenarioSwitcher() {
  const config = useScenarioStore((s) => s.config);
  const index = useScenarioStore((s) => s.index);
  const select = useScenarioStore((s) => s.select);
  const removeCustom = useScenarioStore((s) => s.removeCustom);
  const setBuilderOpen = useScenarioStore((s) => s.setBuilderOpen);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);
  const bundled = index.filter((s) => !s.custom);
  const custom = index.filter((s) => s.custom);
  const item = (s: (typeof index)[number]) => (
    <div key={s.id} className="group flex items-center rounded-[10px] hover:bg-black/[0.04]">
      <button
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
        onClick={() => {
          setOpen(false);
          if (s.id !== config?.id) select(s.id);
        }}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{s.name}</span>
          <span className="block truncate text-[11.5px] text-muted">
            {s.river} · {EVENT_LABEL[s.event] ?? s.event}
          </span>
        </span>
        {s.id === config?.id && <Check className="h-4 w-4 shrink-0 text-accent" />}
      </button>
      {s.custom && (
        <button
          className="mr-2 hidden h-7 w-7 items-center justify-center rounded-full text-faint hover:bg-black/[0.06] hover:text-critical group-hover:flex"
          aria-label={`Delete ${s.name}`}
          onClick={() => removeCustom(s.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
  return (
    <div ref={ref} className="relative">
      <button className="flex items-center gap-2 rounded-full py-1 pl-3 pr-2 transition-colors hover:bg-black/[0.04]" onClick={() => setOpen(!open)}>
        <span className="text-left">
          <span className="block max-w-[220px] truncate text-[13px] font-semibold leading-tight">{config?.name ?? 'Loading…'}</span>
          <span className="block max-w-[220px] truncate text-[11px] leading-tight text-muted">{config ? `${config.river} · ${EVENT_LABEL[config.event]}` : ' '}</span>
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="glass-strong absolute left-0 top-[calc(100%+10px)] z-50 w-[320px] origin-top-left rounded-2xl p-1.5 shadow-panel"
          >
            <div className="eyebrow px-3 pb-1 pt-2">Bundled scenarios</div>
            {bundled.map(item)}
            {custom.length > 0 && (
              <>
                <div className="eyebrow px-3 pb-1 pt-3">Built on this device</div>
                {custom.map(item)}
              </>
            )}
            <div className="my-1.5 h-px bg-hairline" />
            <button
              className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13px] font-medium text-accent hover:bg-accent/[0.06]"
              onClick={() => {
                setOpen(false);
                setBuilderOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              New scenario for any river…
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const LAYERS: { value: MapLayer; label: string; title: string }[] = [
  { value: 'depth', label: 'Depth', title: 'Water depth at the playhead' },
  { value: 'maxDepth', label: 'Peak depth', title: 'Deepest water reached so far' },
  { value: 'arrival', label: 'Arrival', title: 'Time after the breach when water arrived' },
  { value: 'hazard', label: 'Hazard', title: 'Depth × velocity hazard to people (AIDR H1–H6)' },
  { value: 'velocity', label: 'Velocity', title: 'Fastest flow reached' },
  { value: 'difference', label: 'Difference', title: 'SPH minus grid depth' },
];

export default function TopBar() {
  const view = useSimStore((s) => s.view);
  const setView = useSimStore((s) => s.setView);
  const runs = useSimStore((s) => s.runs);
  const hasExternal = useScenarioStore((s) => !!s.external);
  const setExportOpen = useUiStore((s) => s.setExportOpen);
  const bothRan = runs.swe.frames > 0 && runs.sph.frames > 0;
  const anyResults = runs.swe.frames > 0 || runs.sph.frames > 0;

  return (
    <div className="pointer-events-none absolute inset-x-4 top-4 z-20 flex items-start justify-between gap-3">
      <div className="glass pointer-events-auto flex h-12 items-center gap-1 rounded-full pl-2 pr-1 shadow-float">
        <div className="flex items-center gap-2 pr-2">
          <Logo className="h-8 w-8" />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">Cascade</span>
        </div>
        <div className="h-6 w-px bg-hairline" />
        <ScenarioSwitcher />
      </div>

      <div className="glass pointer-events-auto hidden h-12 items-center rounded-full px-1.5 shadow-float xl:flex">
        <Segmented
          layoutId="layer-seg"
          value={view.layer}
          onChange={(layer) => setView({ layer })}
          options={LAYERS.map((l) => ({
            ...l,
            disabled: l.value === 'difference' ? !(bothRan || (hasExternal && runs.swe.frames > 0)) : false,
          }))}
          className="bg-transparent"
        />
      </div>

      <div className="glass pointer-events-auto flex h-12 items-center gap-1.5 rounded-full pl-1.5 pr-1.5 shadow-float">
        {/* Compact layer picker where the full layer bar does not fit. */}
        <select
          aria-label="Map layer"
          value={view.layer}
          onChange={(e) => setView({ layer: e.target.value as MapLayer })}
          className="h-8 rounded-full bg-fill px-3 text-[12px] font-medium text-ink outline-none xl:hidden"
        >
          {LAYERS.map((l) => (
            <option key={l.value} value={l.value} disabled={l.value === 'difference' && !(bothRan || (hasExternal && runs.swe.frames > 0))}>
              {l.label}
            </option>
          ))}
        </select>
        {bothRan && (
          <Segmented
            size="sm"
            layoutId="engine-seg"
            value={view.engine}
            onChange={(engine) => setView({ engine })}
            options={[
              { value: 'swe', label: 'Grid' },
              { value: 'sph', label: 'SPH' },
              { value: 'overlay', label: 'Both' },
            ]}
          />
        )}
        <Segmented
          size="sm"
          layoutId="dim-seg"
          value={view.terrain3d ? '3d' : '2d'}
          onChange={(v) => setView({ terrain3d: v === '3d' })}
          options={[
            { value: '2d', label: '2D' },
            { value: '3d', label: '3D' },
          ]}
        />
        <Segmented
          size="sm"
          layoutId="base-seg"
          value={view.basemap}
          onChange={(basemap) => setView({ basemap })}
          options={[
            { value: 'satellite', label: 'Satellite' },
            { value: 'light', label: 'Map' },
          ]}
        />
        <Button variant="primary" size="sm" className="ml-1 h-9 px-4" disabled={!anyResults} onClick={() => setExportOpen(true)}>
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
      </div>
    </div>
  );
}
