'use client';

import React, { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Download, X } from 'lucide-react';
import { useScenarioStore } from '@/store/scenarioStore';
import { useSimStore } from '@/store/simulationStore';
import { useUiStore } from '@/store/uiStore';
import { results } from '@/simulation/results';
import type { EngineId } from '@/simulation/types';
import { assessAssets, summarizeImpacts } from '@/lib/analytics';
import { buildLayers, exportGeoJson, exportKml, exportPlacesCsv, exportRasterZip, exportShapefileZip } from '@/lib/export';
import type { ExportContext, ExportLayers } from '@/lib/export';
import { download } from '@/lib/export/formats';
import { exportCap } from '@/lib/export/cap';
import { formatDischarge, formatDuration } from '@/lib/format';
import { Segmented, Spinner } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

const FORMATS = [
  { id: 'kml', title: 'KML', sub: 'Google Earth · depth, arrival and hazard folders, places, roads', ext: 'kml', mime: 'application/vnd.google-earth.kml+xml' },
  { id: 'shp', title: 'Shapefile', sub: 'QGIS · ArcGIS · five layers in WGS 84, zipped', ext: 'zip', mime: 'application/zip' },
  { id: 'geojson', title: 'GeoJSON', sub: 'All vector layers in one file', ext: 'geojson', mime: 'application/geo+json' },
  { id: 'raster', title: 'Rasters', sub: 'Peak depth, arrival, velocity, hazard as ESRI ASCII grids', ext: 'zip', mime: 'application/zip' },
  { id: 'csv', title: 'Places table', sub: 'Evacuation list sorted by arrival time (CSV)', ext: 'csv', mime: 'text/csv' },
  { id: 'cap', title: 'CAP alert', sub: 'Common Alerting Protocol 1.2 (SACHET), English and Hindi, marked as an exercise', ext: 'xml', mime: 'application/xml' },
] as const;

export default function ExportSheet() {
  const open = useUiStore((s) => s.exportOpen);
  const setOpen = useUiStore((s) => s.setExportOpen);
  const config = useScenarioStore((s) => s.config);
  const data = useScenarioStore((s) => s.data);
  const exposure = useScenarioStore((s) => s.exposure);
  const runs = useSimStore((s) => s.runs);
  const event = useSimStore((s) => s.event);
  const setup = useSimStore((s) => s.setup);
  const version = useSimStore((s) => s.resultsVersion);
  const available = (['swe', 'sph'] as EngineId[]).filter((e) => runs[e].frames > 0);
  const [engine, setEngine] = useState<EngineId>('swe');
  const eng = available.includes(engine) ? engine : available[0];
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const cache = useRef<{ key: string; layers: ExportLayers } | null>(null);

  const ctx = useMemo<ExportContext | null>(() => {
    void version;
    if (!open || !eng || !config || !data || !exposure || !setup || !event) return null;
    const r = results.get(eng);
    if (!r?.summary || r.exposure.length === 0) return null;
    const last = r.exposure.length - 1;
    const statuses = assessAssets(exposure, r.exposure, r.times, last, r.summary);
    const impact = summarizeImpacts(exposure, statuses, r.exposure[last]);
    const peak = Math.max(...r.stats.map((s) => s.inflowRate));
    const kind = event.kind === 'controlled-release' ? 'Controlled release' : event.kind === 'lake-outburst' ? 'Lake outburst' : 'Dam break';
    return {
      scenarioId: config.id,
      scenarioName: config.name,
      engineLabel: runs[eng].label || eng,
      grid: data.grid,
      maxDepth: r.summary.maxDepth,
      arrival: r.summary.arrival,
      maxSpeed: r.summary.maxSpeed,
      maxDepthVelocity: r.summary.maxDepthVelocity,
      simulatedSeconds: r.summary.t,
      exposure,
      statuses,
      impact,
      dam: { name: config.dam.name, axis: setup.site.axis },
      eventSummary: `${kind}${event.kind !== 'controlled-release' ? `, breach ${Math.round(event.breachWidth)} m wide forming over ${formatDuration(event.formationTime)}` : ''}; peak outflow ${formatDischarge(peak)}`,
    };
  }, [open, eng, config, data, exposure, setup, event, runs, version]);

  const make = async (id: (typeof FORMATS)[number]['id']) => {
    if (!ctx || !config) return;
    setBusy(id);
    // Let the spinner paint before the synchronous polygonisation.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const key = `${ctx.scenarioId}:${eng}:${ctx.simulatedSeconds}`;
      if (cache.current?.key !== key) cache.current = { key, layers: buildLayers(ctx) };
      const layers = cache.current.layers;
      const f = FORMATS.find((x) => x.id === id)!;
      const base = `cascade_${config.id}_${eng}`;
      const payload =
        id === 'cap'
          ? exportCap(ctx)
          : id === 'kml'
            ? exportKml(ctx, layers)
            : id === 'shp'
              ? exportShapefileZip(ctx, layers)
              : id === 'geojson'
                ? exportGeoJson(ctx, layers)
                : id === 'raster'
                  ? exportRasterZip(ctx, layers)
                  : exportPlacesCsv(ctx, layers);
      const suffix = id === 'shp' ? '_shapefile' : id === 'raster' ? '_rasters' : id === 'csv' ? '_places' : id === 'cap' ? '_alert' : '';
      download(payload, `${base}${suffix}.${f.ext}`, f.mime);
      setDone((d) => [...new Set([...d, id])]);
    } catch (err) {
      useUiStore.getState().toast({ title: 'Export failed', body: err instanceof Error ? err.message : String(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-40 flex items-center justify-center bg-black/20 p-6 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className="glass-strong w-[520px] rounded-[26px] p-7 shadow-panel"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[20px] font-semibold tracking-[-0.02em]">Export results</div>
                <p className="mt-1 text-[13px] text-muted">Peak flood envelope of the whole run, in WGS 84 — ready for GIS, Google Earth and briefing packs.</p>
              </div>
              <button onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-white/[0.08] hover:text-ink" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            {available.length > 1 && (
              <Segmented
                className="mt-5"
                layoutId="export-engine"
                value={eng}
                onChange={(v: EngineId) => setEngine(v)}
                options={[
                  { value: 'swe', label: 'Grid solver' },
                  { value: 'sph', label: 'SPH solver' },
                ]}
              />
            )}
            {!ctx ? (
              <p className="mt-6 text-[13px] text-muted">Results appear here once a run has produced its first summary.</p>
            ) : (
              <div className="mt-5 space-y-2">
                {FORMATS.map((f) => (
                  <button
                    key={f.id}
                    disabled={busy !== null}
                    onClick={() => make(f.id)}
                    className="flex w-full items-center gap-4 rounded-2xl bg-fill/80 px-4 py-3 text-left transition-colors hover:bg-fill-2 disabled:opacity-60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold">{f.title}</div>
                      <div className="truncate text-[12px] text-muted">{f.sub}</div>
                    </div>
                    <span className={cn('flex h-8 w-8 items-center justify-center rounded-full', done.includes(f.id) ? 'bg-good/15 text-good' : 'bg-white/[0.1] text-ink shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.14)]')}>
                      {busy === f.id ? <Spinner /> : done.includes(f.id) ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="mt-5 text-[11px] leading-snug text-faint">
              Includes exposure data © OpenStreetMap contributors and terrain from AWS Terrain Tiles (SRTM). Losses are indicative.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
