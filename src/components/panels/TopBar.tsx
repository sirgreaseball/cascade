'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Download, Plus, Search, Trash2 } from 'lucide-react';
import { DAM_CATALOG, loadNationalDamCatalog, searchDamCatalog, tokenMatchesField, tokenMatchesState } from '@/lib/dams';
import type { DamCatalogEntry } from '@/lib/dams';
import type { ScenarioMeta } from '@/lib/scenario';
import { useEnsembleStore } from '@/store/ensembleStore';
import { useScenarioStore } from '@/store/scenarioStore';
import { useSimStore } from '@/store/simulationStore';
import type { MapLayer } from '@/store/simulationStore';
import { useUiStore } from '@/store/uiStore';
import { Button, Hint, Segmented } from '@/components/ui/primitives';
import { SPLASH_URL } from '@/lib/links';
import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#f2f2f2" />
      <path d="M7 12.5c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.3-2 4.5-2 2.3 2 4.5 2" stroke="#050505" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M7 17c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.3-2 4.5-2 2.3 2 4.5 2" stroke="#050505" strokeOpacity="0.72" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M7 21.5c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.3-2 4.5-2 2.3 2 4.5 2" stroke="#050505" strokeOpacity="0.44" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

const EVENT_LABEL: Record<string, string> = {
  'dam-break': 'Dam break',
  'lake-outburst': 'Lake outburst',
  'controlled-release': 'Controlled release',
};

type VirtualRow =
  | { type: 'header'; key: string; title: string; subtitle?: string }
  | { type: 'scenario'; key: string; scenario: ScenarioMeta }
  | { type: 'dam'; key: string; dam: DamCatalogEntry };

function VirtualRowList({
  rows,
  renderScenario,
  renderDam,
}: {
  rows: VirtualRow[];
  renderScenario: (s: ScenarioMeta) => React.ReactNode;
  renderDam: (d: DamCatalogEntry) => React.ReactNode;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerHeight = 360;

  if (rows.length <= 15) {
    return (
      <div className="scroll-soft max-h-[360px] overflow-y-auto pr-0.5">
        {rows.map((row) => {
          if (row.type === 'header') {
            return (
              <div key={row.key} className="eyebrow flex items-baseline justify-between px-3 pb-1 pt-2.5">
                <span>{row.title}</span>
                {row.subtitle && <span className="text-[10.5px] font-normal normal-case text-muted">{row.subtitle}</span>}
              </div>
            );
          }
          if (row.type === 'scenario') return <React.Fragment key={row.key}>{renderScenario(row.scenario)}</React.Fragment>;
          return <React.Fragment key={row.key}>{renderDam(row.dam)}</React.Fragment>;
        })}
      </div>
    );
  }

  const heights = rows.map((r) => (r.type === 'header' ? 28 : 46));
  const offsets: number[] = [0];
  for (let i = 0; i < heights.length; i++) {
    offsets.push(offsets[i] + heights[i]);
  }
  const totalHeight = offsets[offsets.length - 1];

  const overscan = 4;
  let start = 0;
  while (start < rows.length && offsets[start + 1] < scrollTop) {
    start++;
  }
  start = Math.max(0, start - overscan);

  let end = start;
  while (end < rows.length && offsets[end] < scrollTop + containerHeight) {
    end++;
  }
  end = Math.min(rows.length, end + overscan);

  const topPad = offsets[start];
  const bottomPad = Math.max(0, totalHeight - offsets[end]);

  return (
    <div
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="scroll-soft max-h-[360px] overflow-y-auto pr-0.5"
    >
      <div style={{ paddingTop: topPad, paddingBottom: bottomPad }}>
        {rows.slice(start, end).map((row) => {
          if (row.type === 'header') {
            return (
              <div key={row.key} className="eyebrow flex items-baseline justify-between px-3 pb-1 pt-2.5">
                <span>{row.title}</span>
                {row.subtitle && <span className="text-[10.5px] font-normal normal-case text-muted">{row.subtitle}</span>}
              </div>
            );
          }
          if (row.type === 'scenario') return <React.Fragment key={row.key}>{renderScenario(row.scenario)}</React.Fragment>;
          return <React.Fragment key={row.key}>{renderDam(row.dam)}</React.Fragment>;
        })}
      </div>
    </div>
  );
}

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
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, []);

  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const [catalog, setCatalog] = useState<DamCatalogEntry[]>(DAM_CATALOG);
  useEffect(() => {
    if (open) {
      loadNationalDamCatalog().then((list) => setCatalog(list));
    }
  }, [open]);

  const hitsScenario = (s: ScenarioMeta) => {
    if (!q) return true;
    const tokens = q.split(' ').filter(Boolean);
    return tokens.every(
      (t) =>
        tokenMatchesField(t, s.name) ||
        tokenMatchesField(t, s.river) ||
        tokenMatchesState(t, s.state ?? '') ||
        tokenMatchesField(t, s.district) ||
        tokenMatchesField(t, s.event) ||
        (s.historical && (t === 'historical' || t === 'history' || t === 'disaster')) ||
        (s.year && String(s.year).includes(t))
    );
  };
  const historical = index.filter((s) => !s.custom && s.historical && hitsScenario(s));
  const hypothetical = index.filter((s) => !s.custom && !s.historical && hitsScenario(s));
  const custom = index.filter((s) => s.custom && hitsScenario(s));

  const loadedIds = useMemo(() => new Set(index.map((s) => s.id)), [index]);
  const damGroups = useMemo(() => {
    if (!q) return [];
    return searchDamCatalog(query, catalog, loadedIds);
  }, [query, q, catalog, loadedIds]);

  const rows = useMemo<VirtualRow[]>(() => {
    const res: VirtualRow[] = [];
    if (historical.length > 0) {
      res.push({
        type: 'header',
        key: 'h-historical',
        title: 'Historical Events',
        subtitle: 'Reconstructed from observations',
      });
      for (const s of historical) {
        res.push({ type: 'scenario', key: `s-${s.id}`, scenario: s });
      }
    }
    if (hypothetical.length > 0) {
      res.push({
        type: 'header',
        key: 'h-hypothetical',
        title: q ? 'Hypothetical Scenarios' : 'Hypothetical Dam Breaks',
      });
      for (const s of hypothetical) {
        res.push({ type: 'scenario', key: `s-${s.id}`, scenario: s });
      }
    }
    if (custom.length > 0) {
      res.push({ type: 'header', key: 'h-custom', title: 'Built on this device' });
      for (const s of custom) {
        res.push({ type: 'scenario', key: `c-${s.id}`, scenario: s });
      }
    }
    for (const g of damGroups) {
      res.push({ type: 'header', key: `hg-${g.key}`, title: g.title, subtitle: g.subtitle });
      for (const d of g.dams) {
        res.push({ type: 'dam', key: `d-${d.id}`, dam: d });
      }
    }
    return res;
  }, [historical, hypothetical, custom, damGroups, q]);

  const item = (s: ScenarioMeta) => (
    <div key={s.id} className="group flex items-center rounded-[10px] hover:bg-white/[0.06]">
      <button
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
        onClick={() => {
          setOpen(false);
          if (s.id !== config?.id) select(s.id);
        }}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="block truncate text-[13px] font-medium text-ink">{s.name}</span>
            {s.historical && (
              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9.5px] font-semibold text-accent">
                {s.year || 'Historical'}
              </span>
            )}
          </span>
          <span className="block truncate text-[11.5px] text-muted">
            {s.river} · {EVENT_LABEL[s.event] ?? s.event}{s.state ? ` · ${s.state}` : ''}
          </span>
        </span>
        {s.id === config?.id && <Check className="h-4 w-4 shrink-0 text-accent" />}
      </button>
      {s.custom && (
        <button
          className="mr-2 hidden h-7 w-7 items-center justify-center rounded-full text-faint hover:bg-white/[0.08] hover:text-critical group-hover:flex"
          aria-label={`Delete ${s.name}`}
          onClick={() => removeCustom(s.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  const damItem = (d: DamCatalogEntry) => (
    <button
      key={d.id}
      className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left hover:bg-white/[0.06]"
      onClick={() => {
        setOpen(false);
        setQuery('');
        setBuilderOpen(true, d.id);
      }}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{d.name}</span>
        <span className="block truncate text-[11.5px] text-muted">
          {d.river} · {d.height > 0 ? `${d.height} m · ` : ''}{d.type || 'Dam'}{d.district && d.district !== d.name ? ` · ${d.district}` : ''}
        </span>
      </span>
      <Plus className="h-3.5 w-3.5 shrink-0 text-faint" />
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        className="flex items-center gap-2 rounded-full py-1 pl-3 pr-2 transition-colors hover:bg-white/[0.06]"
        onClick={() => {
          setQuery('');
          setOpen(!open);
        }}
      >
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
            className="glass-strong absolute left-0 top-[calc(100%+10px)] z-50 w-[340px] origin-top-left rounded-2xl p-1.5 shadow-panel"
          >
            <label className="relative mx-1 mb-1 mt-0.5 flex items-center">
              <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-faint" />
              <span className="sr-only">Search dams, rivers and states</span>
              <input
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a dam, river or state…"
                className="h-9 w-full rounded-[10px] bg-fill pl-8 pr-3 text-[12.5px] text-ink outline-none transition-colors placeholder:text-faint focus:bg-fill-2"
              />
            </label>

            {rows.length > 0 ? (
              <VirtualRowList rows={rows} renderScenario={item} renderDam={damItem} />
            ) : (
              <div className="px-3 py-3 text-[12.5px] text-muted">Nothing matches “{query.trim()}”.</div>
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
  { value: 'probability', label: 'Chance', title: 'Share of the ensemble’s runs that flood each place' },
];
/**
 * A layer with nothing to show is left out of the bar rather than greyed out: a dead control
 * invites a click that does nothing. Difference needs two results to subtract (both solvers, or
 * an imported model); Chance needs an ensemble.
 */
function availableLayers(diff: boolean, ensemble: boolean) {
  return LAYERS.filter((l) => (l.value === 'difference' ? diff : l.value === 'probability' ? ensemble : true));
}

export default function TopBar() {
  const view = useSimStore((s) => s.view);
  const setView = useSimStore((s) => s.setView);
  const runs = useSimStore((s) => s.runs);
  const hasExternal = useScenarioStore((s) => !!s.external);
  const hasEnsemble = useEnsembleStore((s) => !!s.result);
  const setExportOpen = useUiStore((s) => s.setExportOpen);
  const engines = useSimStore((s) => s.engines);
  const bothRan = runs.swe.frames > 0 && runs.sph.frames > 0;
  const anyResults = runs.swe.frames > 0 || runs.sph.frames > 0;
  const diffAvailable = bothRan || (hasExternal && runs.swe.frames > 0);

  // Never leave the map on a view whose data has gone (e.g. after a new run starts).
  useEffect(() => {
    if (view.layer === 'difference' && !diffAvailable) setView({ layer: 'depth' });
    if (view.layer === 'probability' && !hasEnsemble) setView({ layer: 'depth' });
    if (view.engine === 'overlay' && !bothRan && anyResults) setView({ engine: engines.swe ? 'swe' : 'sph' });
  }, [view.layer, view.engine, diffAvailable, hasEnsemble, bothRan, anyResults, engines.swe, setView]);

  return (
    <div className="pointer-events-none absolute inset-x-4 top-4 z-30 flex items-start justify-between gap-3">
      <div className="glass-pill pointer-events-auto flex h-12 items-center gap-1 rounded-full pl-2 pr-1 shadow-float">
        <Hint title="Cascade" body="Back to the Cascade front page.">
          <a
            href={SPLASH_URL}
            className="flex items-center gap-2 rounded-full pr-2 transition-opacity hover:opacity-80"
            aria-label="Back to the Cascade front page"
          >
            <Logo className="h-8 w-8" />
            <span className="text-[15px] font-semibold tracking-[-0.02em]">Cascade</span>
          </a>
        </Hint>
        <div className="h-6 w-px bg-hairline" />
        <ScenarioSwitcher />
      </div>

      <div className="glass-pill pointer-events-auto hidden h-12 items-center rounded-full px-1.5 shadow-float min-[1440px]:flex">
        <Segmented
          layoutId="layer-seg"
          value={view.layer}
          onChange={(layer) => setView({ layer })}
          options={availableLayers(diffAvailable, hasEnsemble)}
          className="bg-transparent"
        />
      </div>

      <div className="glass-pill pointer-events-auto flex h-12 items-center gap-1.5 rounded-full pl-1.5 pr-1.5 shadow-float">
        {/* Compact layer picker where the full layer bar does not fit. */}
        <label className="relative min-[1440px]:hidden">
          <span className="sr-only">Map layer</span>
          <select
            value={view.layer}
            onChange={(e) => setView({ layer: e.target.value as MapLayer })}
            className="h-8 cursor-pointer appearance-none rounded-full bg-fill py-0 pl-3 pr-7 text-[12px] font-medium text-ink outline-none transition-colors hover:bg-fill-2"
          >
            {availableLayers(diffAvailable, hasEnsemble).map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-2 h-4 w-4 text-muted" />
        </label>
        {bothRan && (
          <Segmented
            size="sm"
            layoutId="engine-seg"
            value={view.engine}
            onChange={(engine) => setView({ engine })}
            options={[
              { value: 'swe', label: 'Grid', title: 'The shallow-water grid solver: the reference result, and the one the impact figures use.' },
              { value: 'sph', label: 'SPH', title: 'Smoothed-particle hydrodynamics: an independent check with far fewer degrees of freedom, so it spreads wider.' },
              { value: 'overlay', label: 'Both', title: 'Draw both solvers together to see where they agree.' },
            ]}
          />
        )}
        <Segmented
          size="sm"
          layoutId="dim-seg"
          value={view.terrain3d ? '3d' : '2d'}
          onChange={(v) => setView({ terrain3d: v === '3d' })}
          options={[
            { value: '2d', label: '2D', title: 'Flat map: fastest, and the clearest view of the flood extent.' },
            { value: '3d', label: '3D', title: 'Terrain from SRTM elevation tiles, with the flood draped over the valley.' },
          ]}
        />
        <div className="hidden min-[1180px]:block">
          <Segmented
            size="sm"
            layoutId="base-seg"
            value={view.basemap}
            onChange={(basemap) => setView({ basemap })}
            options={[
              { value: 'satellite', label: 'Satellite', title: 'Esri World Imagery: real ground cover, the best backdrop for judging what floods.' },
              { value: 'light', label: 'Map', title: 'Dark canvas map: roads and place names stay legible under the flood colours.' },
            ]}
          />
        </div>
        <Button variant="primary" size="sm" className="ml-1 h-9 px-4" disabled={!anyResults} onClick={() => setExportOpen(true)}>
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
      </div>
    </div>
  );
}
