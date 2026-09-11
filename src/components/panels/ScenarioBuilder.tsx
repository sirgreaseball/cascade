'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Crosshair, FileUp, Search, X } from 'lucide-react';
import { useScenarioStore } from '@/store/scenarioStore';
import { useUiStore } from '@/store/uiStore';
import { catalogCrestLine, DAM_CATALOG } from '@/lib/dams';
import type { DamCatalogEntry } from '@/lib/dams';
import { autoStudyArea } from '@/lib/aoi';
import { gridForBBox, gridGeometry } from '@/lib/geo/grid';
import { fillNoData, sampleTerrariumGrid, TERRARIUM_ATTRIBUTION } from '@/lib/geo/terrarium';
import { fetchTerrariumTile } from '@/lib/geo/tiles';
import { crsLabel, readRasterFile, resampleToGrid } from '@/lib/geo/raster';
import { fetchDamLine, fetchOsmExposure, OSM_ATTRIBUTION } from '@/lib/osm';
import type { AssetCollection, AssetKind, RoadCollection } from '@/lib/osm';
import { makeScenarioData, unpackageScenario } from '@/lib/scenario';
import type { ScenarioConfig } from '@/lib/scenario';
import type { EventKind } from '@/simulation/hydrograph';
import { Button, Field, Segmented, Slider, Spinner, TextInput } from '@/components/ui/primitives';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Form {
  name: string;
  river: string;
  region: string;
  lng: number;
  lat: number;
  height: number;
  crestLength: number;
  volumeMCM: number;
  event: EventKind;
  reachKm: number;
  widthKm: number;
  cellSize: number;
  demSource: 'tiles' | 'upload';
  exposureSource: 'osm' | 'upload' | 'none';
}

const fromDam = (d: DamCatalogEntry): Partial<Form> => ({
  name: `${d.name} Dam`,
  river: d.river,
  region: d.state,
  lng: d.lng,
  lat: d.lat,
  height: d.height,
  crestLength: d.crestLength,
  volumeMCM: d.volumeMCM,
  event: 'dam-break',
});

type StepState = 'pending' | 'active' | 'done' | 'error';

function parseExposureGeoJson(text: string): { assets: AssetCollection; roads: RoadCollection } {
  const gj = JSON.parse(text);
  const features: { geometry: { type: string; coordinates: unknown }; properties?: Record<string, unknown> }[] = gj.features ?? [];
  const assets: AssetCollection = { type: 'FeatureCollection', features: [] };
  const roads: RoadCollection = { type: 'FeatureCollection', features: [] };
  const kindOf = (p: Record<string, unknown>): AssetKind => {
    const t = String(p.kind ?? p.type ?? p.amenity ?? p.place ?? '').toLowerCase();
    if (/hospital|clinic|health|doctor/.test(t)) return 'hospital';
    if (/school|college|university/.test(t)) return 'school';
    if (/police|fire|emergency/.test(t)) return 'emergency';
    if (/bridge/.test(t)) return 'bridge';
    return 'settlement';
  };
  features.forEach((f, i) => {
    const p = f.properties ?? {};
    if (f.geometry?.type === 'Point') {
      const kind = kindOf(p);
      const pop = Number(p.population ?? p.pop ?? 0);
      assets.features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: f.geometry.coordinates as [number, number] },
        properties: {
          id: `upload:${i}`,
          kind,
          subtype: String(p.place ?? p.type ?? kind),
          name: String(p.name ?? `Feature ${i + 1}`),
          population: kind === 'settlement' ? (pop > 0 ? pop : 1000) : 0,
          populationEstimated: kind === 'settlement' && !(pop > 0),
        },
      });
    } else if (f.geometry?.type === 'LineString') {
      roads.features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: f.geometry.coordinates as [number, number][] },
        properties: { id: `upload:${i}`, name: String(p.name ?? ''), highway: String(p.highway ?? 'secondary'), bridge: p.bridge === 'yes' || p.bridge === true },
      });
    }
  });
  return { assets, roads };
}

export default function ScenarioBuilder() {
  const open = useScenarioStore((s) => s.builderOpen);
  const setOpen = useScenarioStore((s) => s.setBuilderOpen);
  const addCustom = useScenarioStore((s) => s.addCustom);
  const pickingDam = useUiStore((s) => s.pickingDam);
  const setPickingDam = useUiStore((s) => s.setPickingDam);
  const toast = useUiStore((s) => s.toast);
  const [form, setForm] = useState<Form>(() => ({
    ...(fromDam(DAM_CATALOG.find((d) => d.id === 'koyna')!) as Form),
    reachKm: 30,
    widthKm: 12,
    cellSize: 90,
    demSource: 'tiles',
    exposureSource: 'osm',
  }));
  const [query, setQuery] = useState('');
  const [catalogId, setCatalogId] = useState<string | null>('koyna');
  const [demFile, setDemFile] = useState<File | null>(null);
  const [exposureFile, setExposureFile] = useState<File | null>(null);
  const [steps, setSteps] = useState<{ label: string; state: StepState; detail?: string }[] | null>(null);
  const abort = useRef<AbortController | null>(null);
  const demRef = useRef<HTMLInputElement>(null);
  const expRef = useRef<HTMLInputElement>(null);
  const pkgRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onPick = (e: Event) => {
      const { lng, lat } = (e as CustomEvent<{ lng: number; lat: number }>).detail;
      setForm((f) => ({ ...f, lng: Number(lng.toFixed(5)), lat: Number(lat.toFixed(5)) }));
      setCatalogId(null);
    };
    window.addEventListener('cascade:pick', onPick);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useUiStore.getState().setPickingDam(false);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('cascade:pick', onPick);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DAM_CATALOG.filter((d) => !q || `${d.name} ${d.river} ${d.state}`.toLowerCase().includes(q));
  }, [query]);

  const estimatedCells = Math.round(((form.reachKm + form.widthKm) * form.widthKm * 1e6) / (form.cellSize * form.cellSize));
  const building = steps !== null && steps.some((s) => s.state === 'active');
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const run = async () => {
    const plan = [
      { label: 'Following the river downstream', state: 'active' as StepState },
      { label: form.demSource === 'tiles' ? 'Downloading SRTM terrain' : 'Reading your elevation model', state: 'pending' as StepState },
      { label: form.exposureSource === 'osm' ? 'Fetching places and roads from OpenStreetMap' : form.exposureSource === 'upload' ? 'Reading your exposure layer' : 'Skipping exposure data', state: 'pending' as StepState },
      { label: 'Saving the scenario on this device', state: 'pending' as StepState },
    ];
    setSteps(plan);
    const update = (i: number, state: StepState, detail?: string) =>
      setSteps((s) => s && s.map((x, j) => (j === i ? { ...x, state, detail: detail ?? x.detail } : j === i + 1 && state === 'done' ? { ...x, state: 'active' } : x)));
    abort.current = new AbortController();
    const signal = abort.current.signal;
    const fetchTile = (z: number, x: number, y: number) => fetchTerrariumTile(z, x, y, signal);
    try {
      let stepIndex = 0;
      const area = await autoStudyArea(form.lng, form.lat, form.reachKm, form.widthKm, fetchTile);
      update(stepIndex++, 'done', `${formatNumber(area.reachKm, 1)} km of river`);
      const spec = gridForBBox(area.bbox, form.cellSize, 360_000);
      const grid = gridGeometry(spec);

      let dem: Float32Array;
      let demSourceLabel: string;
      if (form.demSource === 'upload') {
        if (!demFile) throw new Error('Choose an elevation file first.');
        const src = await readRasterFile(demFile, [form.lng, form.lat]);
        dem = resampleToGrid(src, grid, 'mean');
        let missing = 0;
        for (const v of dem) if (!Number.isFinite(v)) missing++;
        if (missing > dem.length * 0.5) throw new Error('Your elevation model covers less than half of the study area.');
        fillNoData(dem, grid.cols, grid.rows);
        demSourceLabel = `${demFile.name} (${crsLabel(src.crs)}), resampled to ${form.cellSize} m`;
      } else {
        const res = await sampleTerrariumGrid(spec, fetchTile, {
          onProgress: ({ loaded, total }) => update(stepIndex, 'active', `${loaded} of ${total} tiles`),
        });
        if (res.missingTiles > 0) throw new Error(`${res.missingTiles} terrain tiles failed to download. Check the connection and try again.`);
        dem = res.elevation;
        demSourceLabel = `${TERRARIUM_ATTRIBUTION}, zoom ${res.zoom}, box-filtered to ${form.cellSize} m`;
      }
      update(stepIndex++, 'done', `${spec.cols} × ${spec.rows} cells`);

      let assets: AssetCollection = { type: 'FeatureCollection', features: [] };
      let roads: RoadCollection = { type: 'FeatureCollection', features: [] };
      let exposureSource = 'None';
      if (form.exposureSource === 'osm') {
        const osm = await fetchOsmExposure(spec.bbox, fetch, signal, (m) => update(stepIndex, 'active', m));
        assets = osm.assets;
        roads = osm.roads;
        exposureSource = `${OSM_ATTRIBUTION} (Overpass API)`;
      } else if (form.exposureSource === 'upload' && exposureFile) {
        ({ assets, roads } = parseExposureGeoJson(await exposureFile.text()));
        exposureSource = exposureFile.name;
      }
      // The real crest, so the modelled dam sits where the imagery shows it: stored for catalogue
      // dams, otherwise looked up in OpenStreetMap.
      const crestLine =
        form.event === 'lake-outburst'
          ? undefined
          : (catalogCrestLine(form.lng, form.lat) ?? (await fetchDamLine(form.lng, form.lat, form.crestLength, fetch, signal).catch(() => undefined)));
      update(stepIndex++, 'done', `${formatNumber(assets.features.length)} places, ${formatNumber(roads.features.length)} roads`);

      const today = new Date().toISOString().slice(0, 10);
      const slug = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scenario';
      const spanKm = Math.max((spec.bbox[2] - spec.bbox[0]) * 96, (spec.bbox[3] - spec.bbox[1]) * 111);
      const config: ScenarioConfig = {
        id: `custom-${slug}-${Date.now().toString(36)}`,
        name: form.name,
        river: form.river,
        region: form.region,
        event: form.event,
        summary: `${form.event === 'lake-outburst' ? 'Outburst of a blockage lake' : form.event === 'controlled-release' ? 'Controlled release' : 'Hypothetical breach'} on the ${form.river}, routed ${formatNumber(area.reachKm, 0)} km downstream. Built in Cascade on ${today}.`,
        bbox: spec.bbox,
        cellSize: form.cellSize,
        grid: { cols: spec.cols, rows: spec.rows },
        dem: { source: demSourceLabel, retrieved: today },
        exposure: { source: exposureSource, retrieved: today },
        dam: {
          name: form.name,
          lng: form.lng,
          lat: form.lat,
          height: form.height,
          crestLength: form.crestLength,
          volumeMCM: form.volumeMCM,
          waterDepth: form.height * 0.95,
          snapRadius: 500,
          crestLine,
        },
        defaults: { manning: 0.045, duration: Math.min(12, Math.max(2, Math.round(area.reachKm / 12) + 2)) * 3600, failureMode: 'overtopping' },
        view: { zoom: Math.max(8.5, Math.min(12, 13.6 - Math.log2(spanKm))), pitch: 55, bearing: 0 },
        notes: 'Dam figures are approximate; verify against the owner’s data before operational use.',
        custom: true,
        createdAt: new Date().toISOString(),
      };
      const data = makeScenarioData(config, dem, assets, roads);
      await addCustom(config, data);
      update(stepIndex, 'done');
      toast({ title: `${form.name} is ready`, body: 'Press Run simulation to model the flood.', tone: 'success' });
      setTimeout(() => {
        setOpen(false);
        setSteps(null);
      }, 700);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSteps((s) => s && s.map((x) => (x.state === 'active' ? { ...x, state: 'error', detail: message } : x)));
    }
  };

  return (
    <>
      <AnimatePresence>
        {open && !pickingDam && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/20 p-6 backdrop-blur-[2px]"
            onMouseDown={(e) => e.target === e.currentTarget && !building && setOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              className="glass-strong flex max-h-full w-[600px] flex-col overflow-hidden rounded-[26px] shadow-panel"
            >
              <div className="flex items-start justify-between px-7 pb-3 pt-6">
                <div>
                  <div className="text-[20px] font-semibold tracking-[-0.02em]">New scenario</div>
                  <p className="mt-1 text-[13px] text-muted">Any dam or blockage in India. Terrain and exposure are fetched from open data.</p>
                </div>
                <button onClick={() => !building && setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-white/[0.08] hover:text-ink" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {steps ? (
                <div className="space-y-3 px-7 pb-7 pt-2">
                  {steps.map((s, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-5 w-5 items-center justify-center">
                        {s.state === 'active' ? <Spinner /> : s.state === 'done' ? <Check className="h-4 w-4 text-good" /> : s.state === 'error' ? <X className="h-4 w-4 text-critical" /> : <span className="h-1.5 w-1.5 rounded-full bg-fill-2" />}
                      </div>
                      <div>
                        <div className={cn('text-[13.5px]', s.state === 'pending' ? 'text-faint' : 'text-ink')}>{s.label}</div>
                        {s.detail && <div className={cn('text-[12px]', s.state === 'error' ? 'text-critical' : 'text-muted')}>{s.detail}</div>}
                      </div>
                    </div>
                  ))}
                  {steps.some((s) => s.state === 'error') && (
                    <div className="flex gap-2 pt-2">
                      <Button onClick={() => setSteps(null)}>Back</Button>
                      <Button variant="primary" onClick={run}>
                        Try again
                      </Button>
                    </div>
                  )}
                  {building && (
                    <Button variant="ghost" onClick={() => abort.current?.abort()}>
                      Cancel
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <div className="scroll-soft flex-1 space-y-6 overflow-y-auto px-7 pb-4">
                    <section className="space-y-3">
                      <div className="text-[13px] font-semibold">1 · Dam or blockage</div>
                      <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-faint" />
                        <TextInput className="pl-9" placeholder="Search major Indian dams" value={query} onChange={(e) => setQuery(e.target.value)} />
                      </div>
                      <div className="scroll-soft grid max-h-[150px] grid-cols-2 gap-1.5 overflow-y-auto">
                        {matches.map((d) => (
                          <button
                            key={d.id}
                            onClick={() => {
                              setCatalogId(d.id);
                              set(fromDam(d));
                            }}
                            className={cn('rounded-xl px-3 py-2 text-left transition-colors', catalogId === d.id ? 'bg-ink text-canvas' : 'bg-fill hover:bg-fill-2')}
                          >
                            <div className="truncate text-[12.5px] font-medium">{d.name}</div>
                            <div className={cn('truncate text-[11px]', catalogId === d.id ? 'text-canvas/70' : 'text-muted')}>
                              {d.river} · {d.state}
                            </div>
                          </button>
                        ))}
                      </div>
                      <div className="flex items-end gap-2">
                        <Field label="Longitude">
                          <TextInput type="number" step="0.0001" value={form.lng} onChange={(e) => { set({ lng: Number(e.target.value) }); setCatalogId(null); }} />
                        </Field>
                        <Field label="Latitude">
                          <TextInput type="number" step="0.0001" value={form.lat} onChange={(e) => { set({ lat: Number(e.target.value) }); setCatalogId(null); }} />
                        </Field>
                        <Button className="h-9 shrink-0" onClick={() => setPickingDam(true)}>
                          <Crosshair className="h-3.5 w-3.5" /> Pick on map
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Name">
                          <TextInput value={form.name} onChange={(e) => set({ name: e.target.value })} />
                        </Field>
                        <Field label="River">
                          <TextInput value={form.river} onChange={(e) => set({ river: e.target.value })} />
                        </Field>
                      </div>
                      <Segmented
                        layoutId="builder-kind"
                        value={form.event}
                        onChange={(event: EventKind) => set({ event })}
                        options={[
                          { value: 'dam-break', label: 'Dam break' },
                          { value: 'lake-outburst', label: 'Lake outburst' },
                          { value: 'controlled-release', label: 'Release' },
                        ]}
                      />
                      <div className="grid grid-cols-3 gap-3">
                        <Field label="Height (m)">
                          <TextInput type="number" value={form.height} onChange={(e) => set({ height: Number(e.target.value) })} />
                        </Field>
                        <Field label="Crest length (m)">
                          <TextInput type="number" value={form.crestLength} onChange={(e) => set({ crestLength: Number(e.target.value) })} />
                        </Field>
                        <Field label="Storage (million m³)">
                          <TextInput type="number" value={form.volumeMCM} onChange={(e) => set({ volumeMCM: Number(e.target.value) })} />
                        </Field>
                      </div>
                    </section>

                    <section className="space-y-3">
                      <div className="text-[13px] font-semibold">2 · Study area</div>
                      <p className="-mt-1 text-[12px] text-muted">Cascade follows the river downstream on the terrain and draws the model domain around it.</p>
                      <Slider label="Distance downstream" value={form.reachKm} min={8} max={90} step={1} onChange={(reachKm) => set({ reachKm })} format={(v) => `${v} km`} />
                      <Slider label="Corridor width" value={form.widthKm} min={4} max={40} step={1} onChange={(widthKm) => set({ widthKm })} format={(v) => `${v} km`} />
                      <Segmented
                        layoutId="builder-cell"
                        value={String(form.cellSize)}
                        onChange={(v) => set({ cellSize: Number(v) })}
                        options={[
                          { value: '60', label: '60 m cells' },
                          { value: '90', label: '90 m' },
                          { value: '120', label: '120 m' },
                        ]}
                      />
                      <p className="text-[11px] text-faint">About {formatNumber(Math.min(estimatedCells, 360_000))} cells{estimatedCells > 360_000 ? ' (capped — cells will be enlarged)' : ''}. Finer cells resolve narrow gorges better but run slower.</p>
                    </section>

                    <section className="space-y-3">
                      <div className="text-[13px] font-semibold">3 · Data</div>
                      <Field label="Terrain">
                        <Segmented
                          layoutId="builder-dem"
                          value={form.demSource}
                          onChange={(demSource: Form['demSource']) => set({ demSource })}
                          options={[
                            { value: 'tiles', label: 'SRTM (online)' },
                            { value: 'upload', label: 'Upload GeoTIFF / ASCII' },
                          ]}
                        />
                      </Field>
                      {form.demSource === 'upload' && (
                        <>
                          <input ref={demRef} type="file" accept=".tif,.tiff,.asc,.txt" className="hidden" onChange={(e) => setDemFile(e.target.files?.[0] ?? null)} />
                          <Button className="w-full" onClick={() => demRef.current?.click()}>
                            <FileUp className="h-3.5 w-3.5" /> {demFile ? demFile.name : 'Choose SRTM / ASTER / CartoDEM file'}
                          </Button>
                        </>
                      )}
                      <Field label="Places and roads">
                        <Segmented
                          layoutId="builder-exp"
                          value={form.exposureSource}
                          onChange={(exposureSource: Form['exposureSource']) => set({ exposureSource })}
                          options={[
                            { value: 'osm', label: 'OpenStreetMap' },
                            { value: 'upload', label: 'Upload GeoJSON' },
                            { value: 'none', label: 'None' },
                          ]}
                        />
                      </Field>
                      {form.exposureSource === 'upload' && (
                        <>
                          <input ref={expRef} type="file" accept=".geojson,.json" className="hidden" onChange={(e) => setExposureFile(e.target.files?.[0] ?? null)} />
                          <Button className="w-full" onClick={() => expRef.current?.click()}>
                            <FileUp className="h-3.5 w-3.5" /> {exposureFile ? exposureFile.name : 'Choose points (places) and lines (roads)'}
                          </Button>
                        </>
                      )}
                    </section>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-hairline px-7 py-4">
                    <input
                      ref={pkgRef}
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (!f) return;
                        try {
                          const { config, data } = unpackageScenario(await f.text());
                          await addCustom(config, data);
                          setOpen(false);
                          toast({ title: `${config.name} imported`, tone: 'success' });
                        } catch (err) {
                          toast({ title: 'Could not open the scenario file', body: err instanceof Error ? err.message : String(err), tone: 'error' });
                        }
                      }}
                    />
                    <button className="text-[12.5px] font-medium text-muted hover:text-ink" onClick={() => pkgRef.current?.click()}>
                      Open a scenario file…
                    </button>
                    <Button
                      variant="primary"
                      disabled={!form.name || !Number.isFinite(form.lng) || !Number.isFinite(form.lat) || form.height <= 0 || form.volumeMCM <= 0 || (form.demSource === 'upload' && !demFile)}
                      onClick={run}
                    >
                      Build scenario
                    </Button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {pickingDam && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="glass-strong absolute left-1/2 top-[76px] z-40 flex -translate-x-1/2 items-center gap-3 rounded-full py-2 pl-4 pr-2 shadow-float">
            <Crosshair className="h-4 w-4 text-accent" />
            <span className="text-[13px]">Click the dam or blockage on the map</span>
            <Button size="sm" onClick={() => setPickingDam(false)}>
              Cancel
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
