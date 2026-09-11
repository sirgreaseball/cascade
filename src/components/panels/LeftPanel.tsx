'use client';

import React, { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Copy, Download, ExternalLink, FileUp, Play, RotateCcw, X } from 'lucide-react';
import { useScenarioStore } from '@/store/scenarioStore';
import { isRunning, useSimStore } from '@/store/simulationStore';
import { useUiStore } from '@/store/uiStore';
import { controller } from '@/simulation/controller';
import { results } from '@/simulation/results';
import { froehlich2008 } from '@/simulation/hydrograph';
import type { EventKind, FailureMode } from '@/simulation/hydrograph';
import type { Resolution } from '@/simulation/setup';
import { PARTICLE_BUDGET } from '@/simulation/setup';
import { runBenchmarks } from '@/simulation/benchmarks';
import type { BenchmarkResult } from '@/simulation/benchmarks';
import { Button, Divider, Dot, Field, Progress, Section, Segmented, Slider, Switch, Tag, TextInput } from '@/components/ui/primitives';
import { LineChart } from '@/components/ui/charts';
import type { ChartSeries } from '@/components/ui/charts';
import { IDENTITY } from '@/components/map/colormaps';
import { formatCompact, formatDischarge, formatDuration, formatNumber, formatVolume } from '@/lib/format';
import { buildGeeScript, defaultGeeDates, GEE_CODE_EDITOR } from '@/lib/gee';
import type { GeeParams } from '@/lib/gee';
import { importExternalResult, importObservedExtent } from '@/lib/importers';
import { extentAgreement } from '@/lib/compare';
import { packageScenario } from '@/lib/scenario';
import { download } from '@/lib/export/formats';
import { cn } from '@/lib/utils';

const hours = (s: number) => `${(s / 3600).toFixed(s % 3600 === 0 ? 0 : 1)}h`;

/** MacDonald & Langridge-Monopolis (1984) peak-outflow regression, Qp = 1.154 (Vw·Hw)^0.412. */
const mlmPeak = (volume: number, head: number) => 1.154 * (volume * Math.max(head, 0)) ** 0.412;

function EventTab() {
  const config = useScenarioStore((s) => s.config);
  const event = useSimStore((s) => s.event);
  const setEvent = useSimStore((s) => s.setEvent);
  const resetEvent = useSimStore((s) => s.resetEvent);
  const setup = useSimStore((s) => s.setup);
  const setupError = useSimStore((s) => s.setupError);
  const duration = useSimStore((s) => s.duration);
  const version = useSimStore((s) => s.resultsVersion);
  // The chart marker moves in one-minute steps, so the panel is not re-rendered every frame.
  const playhead = useSimStore((s) => Math.round(s.playhead / 60) * 60);
  const hasResults = useSimStore((s) => s.runs.swe.frames > 0 || s.runs.sph.frames > 0);

  const series = useMemo(() => {
    void version;
    const out: ChartSeries[] = [];
    if (setup) out.push({ id: 'free', label: 'Free outflow', color: '#a1a1a6', points: setup.hydrograph.t.map((t, i) => [t, setup.hydrograph.q[i]]) });
    for (const e of ['swe', 'sph'] as const) {
      const r = results.get(e);
      if (r && r.stats.length > 1) {
        out.push({
          id: e,
          label: e === 'swe' ? 'Grid (with tailwater)' : 'SPH (with tailwater)',
          color: e === 'swe' ? IDENTITY.swe : IDENTITY.sph,
          area: e === 'swe',
          points: r.times.map((t, i) => [t, r.stats[i].inflowRate]),
        });
      }
    }
    return out;
  }, [setup, version]);

  if (!config || !event) return null;
  const release = event.kind === 'controlled-release';
  const fr = froehlich2008(event.volume, event.breachDepth, event.failureMode);
  const h = setup?.hydrograph;
  const head = event.waterDepth - (event.damHeight - event.breachDepth);
  const modelledPeak = (() => {
    const r = results.get('swe');
    if (!r || !r.stats.length) return null;
    let best = 0;
    for (let i = 1; i < r.stats.length; i++) if (r.stats[i].inflowRate > r.stats[best].inflowRate) best = i;
    return { q: r.stats[best].inflowRate, t: r.times[best] };
  })();

  return (
    <div className="space-y-6">
      <Section>
        <p className="text-[13px] leading-relaxed text-ink-2">{config.summary}</p>
        <div className="grid grid-cols-3 gap-3 rounded-2xl bg-fill/70 p-3">
          <div>
            <div className="text-[11px] text-muted">Height</div>
            <div className="text-[14px] font-semibold">{formatNumber(config.dam.height)} m</div>
          </div>
          <div>
            <div className="text-[11px] text-muted">Storage</div>
            <div className="text-[14px] font-semibold">{formatVolume(config.dam.volumeMCM * 1e6)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted">{config.dam.completed ? 'Completed' : 'Type'}</div>
            <div className="truncate text-[14px] font-semibold">{config.dam.completed ?? config.dam.type ?? '—'}</div>
          </div>
        </div>
        {config.notes && <p className="text-[11px] leading-snug text-faint">{config.notes}</p>}
      </Section>

      <Section title="Event">
        <Segmented
          layoutId="event-kind"
          value={event.kind}
          onChange={(kind: EventKind) => setEvent({ kind })}
          options={[
            { value: 'dam-break', label: 'Dam break' },
            { value: 'lake-outburst', label: 'Outburst' },
            { value: 'controlled-release', label: 'Release' },
          ]}
        />
        {release ? (
          <div className="space-y-4 pt-1">
            <Slider label="Release discharge" value={event.releaseDischarge} min={100} max={100_000} log step={50} onChange={(v) => setEvent({ releaseDischarge: v })} format={formatDischarge} hint="Gated spillway release on top of base flow." />
            <Slider label="Gates fully open after" value={event.releaseRamp} min={60} max={4 * 3600} log step={60} onChange={(v) => setEvent({ releaseRamp: v })} format={formatDuration} />
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            <Segmented
              size="sm"
              layoutId="failure-mode"
              value={event.failureMode}
              onChange={(failureMode: FailureMode) => setEvent({ failureMode })}
              options={[
                { value: 'overtopping', label: 'Overtopping' },
                { value: 'piping', label: 'Piping' },
              ]}
            />
            <Slider label="Water stored" value={event.volume / 1e6} min={0.1} max={20_000} log step={0.1} onChange={(v) => setEvent({ volume: v * 1e6 })} format={(v) => formatVolume(v * 1e6)} />
            <Slider label="Water depth at the dam" value={event.waterDepth} min={1} max={event.damHeight} step={0.5} onChange={(v) => setEvent({ waterDepth: v })} format={(v) => `${formatNumber(v, 1)} m`} />
            <Slider label="Breach width" value={event.breachWidth} min={5} max={3000} log step={1} onChange={(v) => setEvent({ breachWidth: v })} format={(v) => `${formatNumber(v)} m`} />
            <Slider label="Breach depth" value={event.breachDepth} min={1} max={event.damHeight} step={0.5} onChange={(v) => setEvent({ breachDepth: v })} format={(v) => `${formatNumber(v, 1)} m`} />
            <Slider label="Breach forms over" value={event.formationTime} min={120} max={12 * 3600} log step={30} onChange={(v) => setEvent({ formationTime: v })} format={formatDuration} />
            <div className="flex items-start justify-between gap-3 rounded-xl bg-accent/[0.05] px-3 py-2.5">
              <p className="text-[11.5px] leading-snug text-ink-2">
                Froehlich (2008) suggests a <span className="font-medium">{formatNumber(fr.width)} m</span> breach forming over <span className="font-medium">{formatDuration(fr.formationTime)}</span> for this reservoir.
              </p>
              <button className="shrink-0 text-[12px] font-medium text-accent" onClick={() => setEvent({ breachWidth: Math.round(fr.width), formationTime: Math.round(fr.formationTime) })}>
                Apply
              </button>
            </div>
          </div>
        )}
        <Slider label="River base flow" value={event.baseFlow} min={0} max={5000} step={10} onChange={(v) => setEvent({ baseFlow: v })} format={formatDischarge} />
        <button className="flex items-center gap-1.5 text-[12px] font-medium text-muted hover:text-ink" onClick={resetEvent}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset to scenario defaults
        </button>
      </Section>

      <Divider />

      <Section title={release ? 'Release hydrograph' : 'Breach outflow'}>
        {setupError && <p className="text-[12px] text-critical">{setupError}</p>}
        {series.length > 0 && (
          <LineChart series={series} xMax={duration} yFormat={(v) => formatCompact(v)} xFormat={hours} marker={hasResults ? playhead : null} />
        )}
        {h && (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-[11px] text-muted">Modelled peak</div>
              <div className="text-[14px] font-semibold">{modelledPeak ? formatDischarge(modelledPeak.q) : '—'}</div>
              <div className="text-[10.5px] text-faint">{modelledPeak ? `at ${formatDuration(modelledPeak.t)}, with tailwater` : 'after a run'}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">{release ? 'Peak' : 'Free-outflow bound'}</div>
              <div className="text-[14px] font-semibold">{formatDischarge(h.peak)}</div>
              <div className="text-[10.5px] text-faint">at {formatDuration(h.timeToPeak)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">Released</div>
              <div className="text-[14px] font-semibold">{formatVolume(h.volumeReleased)}</div>
            </div>
          </div>
        )}
        {!release && h?.froehlichPeak && (
          <p className="text-[11px] leading-snug text-faint">
            The free-outflow bound drains the reservoir as if nothing stood below the dam; the modelled peak is what the grid solver lets through against the water already downstream. Empirical estimates for comparison: Froehlich (1995) {formatDischarge(h.froehlichPeak)}, MacDonald & Langridge-Monopolis (1984) {formatDischarge(mlmPeak(event.volume, head))}.
          </p>
        )}
      </Section>
    </div>
  );
}

/** Benchmarks run live in the browser, plus the current run's mass balance. */
function Validation() {
  const [bench, setBench] = useState<BenchmarkResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const version = useSimStore((s) => s.resultsVersion);
  const backend = useSimStore((s) => s.runs.swe.backend);
  const massRow = useMemo((): BenchmarkResult | null => {
    void version;
    const r = results.get('swe');
    const last = r?.stats[r.stats.length - 1];
    if (!last || last.inflowVolume <= 0) return null;
    const error = Math.abs(last.inflowVolume - last.outflowVolume - last.storedVolume) / last.inflowVolume;
    return {
      name: 'Mass balance, this run',
      detail: `Released ${formatVolume(last.inflowVolume)} = left the area ${formatVolume(last.outflowVolume)} + on the ground ${formatVolume(last.storedVolume)}; error ${(error * 100).toExponential(1)} %${backend === 'gpu' ? ' (single precision on the graphics card)' : ''}.`,
      // The GPU computes in single precision: rounding accumulates to around 1e-6 of the volume.
      pass: error < (backend === 'gpu' ? 1e-4 : 1e-8),
    };
  }, [version, backend]);
  const rows = [...(bench ?? []), ...(massRow ? [massRow] : [])];
  return (
    <div className="space-y-2">
      {rows.length > 0 && (
        <div className="divide-y divide-white/[0.08] rounded-2xl bg-fill/70 px-3">
          {rows.map((b) => (
            <div key={b.name} className="flex items-start gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium">{b.name}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-muted">{b.detail}</div>
              </div>
              <Tag tone={b.pass ? 'accent' : 'warning'}>{b.pass ? 'Pass' : 'Check'}</Tag>
            </div>
          ))}
        </div>
      )}
      <Button
        className="w-full"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          // Let the button repaint before the (sub-second) computation blocks the thread.
          setTimeout(() => {
            setBench(runBenchmarks());
            setBusy(false);
          }, 30);
        }}
      >
        {busy ? 'Running benchmarks…' : bench ? 'Run the benchmarks again' : 'Run analytical benchmarks'}
      </Button>
    </div>
  );
}

function ModelTab() {
  const config = useScenarioStore((s) => s.config);
  const data = useScenarioStore((s) => s.data);
  const external = useScenarioStore((s) => s.external);
  const setExternal = useScenarioStore((s) => s.setExternal);
  const engines = useSimStore((s) => s.engines);
  const setEngine = useSimStore((s) => s.setEngine);
  const runs = useSimStore((s) => s.runs);
  const resolution = useSimStore((s) => s.resolution);
  const setResolution = useSimStore((s) => s.setResolution);
  const useGpu = useSimStore((s) => s.useGpu);
  const setUseGpu = useSimStore((s) => s.setUseGpu);
  const duration = useSimStore((s) => s.duration);
  const setDuration = useSimStore((s) => s.setDuration);
  const manning = useSimStore((s) => s.manning);
  const setManning = useSimStore((s) => s.setManning);
  const setup = useSimStore((s) => s.setup);
  const stale = useSimStore((s) => s.stale);
  const version = useSimStore((s) => s.resultsVersion);
  const toast = useUiStore((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const running = isRunning(runs);

  const externalAgreement = useMemo(() => {
    void version;
    const s = results.get('swe')?.summary;
    return external && s ? extentAgreement(s.maxDepth, external.maxDepth) : null;
  }, [external, version]);

  if (!config || !data) return null;
  const g = data.grid;
  const engineRow = (id: 'swe' | 'sph', title: string, body: string) => {
    const r = runs[id];
    return (
      <div className="rounded-2xl bg-fill/70 p-3">
        <div className="flex items-start gap-3">
          <Dot color={id === 'swe' ? IDENTITY.swe : IDENTITY.sph} className="mt-1.5" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">{title}</div>
            <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{body}</p>
          </div>
          <Switch checked={engines[id]} onChange={(v) => setEngine(id, v)} disabled={running} label={title} />
        </div>
        {r.status !== 'idle' && (
          <div className="mt-2.5 space-y-1.5 pl-5">
            <Progress value={r.progress} color={id === 'swe' ? IDENTITY.swe : IDENTITY.sph} />
            <div className="flex justify-between text-[11px] text-muted">
              <span>
                {r.status === 'error' ? <span className="text-critical">{r.error}</span> : r.status === 'done' ? `Finished in ${formatDuration(r.wallMs / 1000)}` : r.status === 'paused' ? 'Paused' : `${Math.round(r.progress * 100)}% computed`}
              </span>
              <span>{r.backend === 'gpu' ? 'Graphics card (WebGPU)' : r.mode === 'worker' ? 'Background worker' : r.mode === 'main-thread' ? 'Main thread' : ''}</span>
            </div>
            {id === 'sph' && r.particleVolume && <div className="text-[11px] text-faint">{formatNumber(r.particleVolume)} m³ of water per particle</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Section title="Solvers" action={<Tag>Run side by side</Tag>}>
        {engineRow('swe', 'Grid solver', '2D shallow-water equations on the DEM grid, finite-volume HLL scheme — the physics of Delft3D-FLOW in 2D mode.')}
        {engineRow('sph', 'SPH solver', 'Smoothed-particle hydrodynamics in shallow-water form: the flood as tens of thousands of moving parcels of water.')}
      </Section>

      <Section title="Settings">
        <Segmented
          layoutId="resolution"
          value={resolution}
          onChange={(r: Resolution) => setResolution(r)}
          options={[
            { value: 'fast', label: 'Fast' },
            { value: 'standard', label: 'Standard' },
            { value: 'high', label: 'Detailed' },
          ]}
        />
        <p className="-mt-1 text-[11px] text-faint">
          {resolution === 'fast'
            ? `Grid solver on cells twice the size (${formatNumber(g.dx * 2, 0)} m), about 8× faster; SPH with ${formatNumber(PARTICLE_BUDGET.fast)} particles. For a first look — use Standard for reported results.`
            : `Grid solver on the scenario's ${formatNumber(g.dx, 0)} m cells; SPH with ${formatNumber(PARTICLE_BUDGET[resolution])} particles.`}
        </p>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12.5px] text-ink-2">Grid solver on the graphics card</div>
            <div className="text-[11px] leading-snug text-faint">WebGPU, many times faster; the processor takes over where it is unavailable.</div>
          </div>
          <Switch checked={useGpu} onChange={setUseGpu} disabled={running} label="Run the grid solver on the graphics card" />
        </div>
        <Slider label="Simulated time" value={duration} min={1800} max={12 * 3600} step={900} onChange={setDuration} format={formatDuration} />
        <Slider
          label="Manning roughness"
          value={manning}
          min={0.02}
          max={0.1}
          step={0.005}
          onChange={setManning}
          format={(v) => v.toFixed(3)}
          hint="0.03 clean channel · 0.045 mountain river · 0.07 forest floodplain"
        />
        <div className="grid grid-cols-2 gap-3 rounded-2xl bg-fill/70 p-3 text-[12px]">
          <div>
            <div className="text-[11px] text-muted">Grid</div>
            <div className="tnum font-medium">
              {g.cols} × {g.rows} · {Math.round(g.dx)} m
            </div>
          </div>
          <div>
            <div className="text-[11px] text-muted">Elevation</div>
            <div className="tnum font-medium">
              {Math.round(data.demRange[0])}–{Math.round(data.demRange[1])} m
            </div>
          </div>
          <div className="col-span-2 text-[11px] leading-snug text-faint">{config.dem.source ?? 'Uploaded DEM'}</div>
          <div className="col-span-2 text-[11px] leading-snug text-muted">
            Features narrower than a {Math.round(g.dx)} m cell — river channels, embankments, levees, bridges and culverts — are not resolved, and the elevation model has no
            river bathymetry, so read depths and arrival times as indicative. A finer DEM (such as CartoDEM from Bhuvan) can be loaded when building a scenario.
          </div>
        </div>
        <Button variant={stale || !(runs.swe.frames || runs.sph.frames) ? 'primary' : 'secondary'} className="w-full" disabled={!setup || running} onClick={() => controller.run()}>
          <Play className="h-3.5 w-3.5 fill-current" />
          {runs.swe.frames || runs.sph.frames ? (stale ? 'Settings changed — run again' : 'Run again') : 'Run simulation'}
        </Button>
      </Section>

      <Divider />

      <Section title="Method and validation">
        <div className="space-y-2 rounded-2xl bg-fill/70 p-3">
          <div className="text-[12.5px] font-medium">2D shallow-water equations</div>
          <div className="tnum text-[11.5px] leading-relaxed text-ink-2">
            ∂h/∂t + ∇·(h<b>u</b>) = 0
            <br />
            ∂(h<b>u</b>)/∂t + ∇·(h<b>u</b>⊗<b>u</b>) + g h ∇(h + z) = −g n² |<b>u</b>| <b>u</b> / h<sup>1/3</sup>
          </div>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-muted">
            <li>Godunov finite volumes with HLL Riemann fluxes (Toro, 2001): captures bores and hydraulic jumps.</li>
            <li>Hydrostatic reconstruction (Audusse et al., 2004): still water stays still, depths stay positive at wet–dry fronts.</li>
            <li>Explicit time step at CFL 0.45; point-implicit Manning friction; open outflow boundaries.</li>
            <li>Breach geometry and timing from Froehlich (2008); the reservoir drains as a level pool against the live tailwater.</li>
            <li>SPH solver: the same equations carried by particles with variable smoothing length (after Vacondio et al., 2012).</li>
          </ul>
        </div>
        <Validation />
      </Section>

      <Divider />

      <Section title="Compare with another model">
        <p className="text-[12px] leading-snug text-muted">
          Load a maximum-depth raster from Delft3D, HEC-RAS or any other model (GeoTIFF or ESRI ASCII, WGS 84 or UTM) to compare it with the grid solver.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".tif,.tiff,.asc,.txt"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setImporting(true);
            try {
              const ext = await importExternalResult(f, data.grid);
              setExternal(ext);
              toast({ title: 'Model result imported', body: ext.source, tone: 'success' });
            } catch (err) {
              toast({ title: 'Could not import the raster', body: err instanceof Error ? err.message : String(err), tone: 'error' });
            } finally {
              setImporting(false);
            }
          }}
        />
        {external ? (
          <div className="rounded-2xl bg-fill/70 p-3">
            <div className="flex items-start gap-2">
              <Dot color={IDENTITY.external} className="mt-1.5" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{external.name}</div>
                <div className="text-[11px] text-muted">{external.source}</div>
              </div>
              <button onClick={() => setExternal(null)} aria-label="Remove" className="text-faint hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>
            {externalAgreement ? (
              <div className="mt-2 grid grid-cols-3 gap-2 pl-4 text-[12px]">
                <div>
                  <div className="text-[11px] text-muted">Agreement</div>
                  <div className="font-semibold">{externalAgreement.csi.toFixed(2)} CSI</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">Hit rate</div>
                  <div className="font-semibold">{Math.round(externalAgreement.hitRate * 100)}%</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">Extent ratio</div>
                  <div className="font-semibold">{externalAgreement.bias.toFixed(2)}×</div>
                </div>
              </div>
            ) : (
              <p className="mt-2 pl-4 text-[11px] text-faint">Run the grid solver to compare.</p>
            )}
          </div>
        ) : (
          <Button className="w-full" disabled={importing} onClick={() => fileRef.current?.click()}>
            <FileUp className="h-3.5 w-3.5" />
            {importing ? 'Reading raster…' : 'Import result raster'}
          </Button>
        )}
      </Section>

      <Section title="Share">
        <Button
          variant="ghost"
          className="w-full justify-start px-0"
          onClick={() => download(packageScenario(config, data), `${config.id}.cascade.json`, 'application/json')}
        >
          <Download className="h-3.5 w-3.5" /> Download this scenario as a file
        </Button>
      </Section>
    </div>
  );
}

function ObserveTab() {
  const config = useScenarioStore((s) => s.config);
  const data = useScenarioStore((s) => s.data);
  const observed = useScenarioStore((s) => s.observed);
  const setObserved = useScenarioStore((s) => s.setObserved);
  const showObserved = useSimStore((s) => s.view.showObserved);
  const setView = useSimStore((s) => s.setView);
  const version = useSimStore((s) => s.resultsVersion);
  const toast = useUiStore((s) => s.toast);
  const [params, setParams] = useState<Omit<GeeParams, 'scenarioId' | 'scenarioName' | 'bbox'>>(() => ({
    ...defaultGeeDates(),
    polarization: 'VH',
    pass: 'DESCENDING',
    threshold: 1.25,
  }));
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const validation = useMemo(() => {
    void version;
    const s = results.get('swe')?.summary ?? results.get('sph')?.summary;
    if (!observed || !s) return null;
    return extentAgreement(observed.mask, s.maxDepth, 0.5, 0.1);
  }, [observed, version]);

  if (!config || !data) return null;
  const script = () => buildGeeScript({ ...params, scenarioId: config.id, scenarioName: config.name, bbox: data.grid.bbox });

  return (
    <div className="space-y-6">
      <Section title="Near-real-time flood mapping">
        <p className="text-[12.5px] leading-relaxed text-ink-2">
          Map what actually flooded from Sentinel-1 radar — it sees through cloud and at night — using Google Earth Engine, then bring the result back here to check the model.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Before, from">
            <TextInput type="date" value={params.preStart} onChange={(e) => setParams({ ...params, preStart: e.target.value })} />
          </Field>
          <Field label="to">
            <TextInput type="date" value={params.preEnd} onChange={(e) => setParams({ ...params, preEnd: e.target.value })} />
          </Field>
          <Field label="After, from">
            <TextInput type="date" value={params.postStart} onChange={(e) => setParams({ ...params, postStart: e.target.value })} />
          </Field>
          <Field label="to">
            <TextInput type="date" value={params.postEnd} onChange={(e) => setParams({ ...params, postEnd: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Segmented size="sm" layoutId="pol" value={params.polarization} onChange={(polarization) => setParams({ ...params, polarization })} options={[{ value: 'VH', label: 'VH' }, { value: 'VV', label: 'VV' }]} />
          <Segmented size="sm" layoutId="pass" value={params.pass} onChange={(pass) => setParams({ ...params, pass })} options={[{ value: 'DESCENDING', label: 'Desc.' }, { value: 'ASCENDING', label: 'Asc.' }]} />
        </div>
        <Slider label="Change threshold (after ÷ before)" value={params.threshold} min={1.05} max={1.8} step={0.01} onChange={(threshold) => setParams({ ...params, threshold })} format={(v) => v.toFixed(2)} hint="UN-SPIDER recommends 1.25. Lower finds more water but more false alarms." />
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(script());
                toast({ title: 'Earth Engine script copied', body: 'Paste it into the Code Editor and press Run.', tone: 'success' });
              } catch {
                download(script(), `cascade_${config.id}_sentinel1.js`, 'text/javascript');
              }
            }}
          >
            <Copy className="h-3.5 w-3.5" /> Copy script
          </Button>
          <Button onClick={() => window.open(GEE_CODE_EDITOR, '_blank', 'noopener')}>
            Code Editor <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
        <button className="text-[12px] font-medium text-muted hover:text-ink" onClick={() => download(script(), `cascade_${config.id}_sentinel1.js`, 'text/javascript')}>
          Download script (.js)
        </button>
      </Section>

      <Divider />

      <Section title="Observed flood extent">
        <input
          ref={fileRef}
          type="file"
          accept=".geojson,.json,.kml,.tif,.tiff"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setBusy(true);
            try {
              const o = await importObservedExtent(f, data.grid);
              setObserved(o);
              setView({ showObserved: true });
              toast({ title: 'Observed extent imported', body: `${o.source}; ${formatNumber((o.cells * data.grid.cellArea) / 1e6, 1)} km² flooded`, tone: 'success' });
            } catch (err) {
              toast({ title: 'Could not import the extent', body: err instanceof Error ? err.message : String(err), tone: 'error' });
            } finally {
              setBusy(false);
            }
          }}
        />
        {observed ? (
          <div className="rounded-2xl bg-fill/70 p-3">
            <div className="flex items-start gap-2">
              <Dot color={IDENTITY.observed} className="mt-1.5" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">{observed.name}</div>
                <div className="text-[11px] text-muted">
                  {observed.source} · {formatNumber((observed.cells * data.grid.cellArea) / 1e6, 1)} km²
                </div>
              </div>
              <Switch checked={showObserved} onChange={(v) => setView({ showObserved: v })} label="Show on map" />
              <button onClick={() => setObserved(null)} aria-label="Remove" className="text-faint hover:text-ink">
                <X className="h-4 w-4" />
              </button>
            </div>
            {validation ? (
              <div className="mt-2.5 grid grid-cols-3 gap-2 pl-4 text-[12px]">
                <div>
                  <div className="text-[11px] text-muted">Agreement</div>
                  <div className="font-semibold">{validation.csi.toFixed(2)} CSI</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">Detected</div>
                  <div className="font-semibold">{Math.round(validation.hitRate * 100)}%</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">False alarm</div>
                  <div className="font-semibold">{Math.round(validation.falseAlarmRatio * 100)}%</div>
                </div>
              </div>
            ) : (
              <p className="mt-2 pl-4 text-[11px] text-faint">Run a simulation to validate against this observation.</p>
            )}
          </div>
        ) : (
          <>
            <p className="text-[12px] leading-snug text-muted">GeoJSON or KML polygons, or a GeoTIFF mask, as exported by the script above.</p>
            <Button className="w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
              <FileUp className="h-3.5 w-3.5" /> {busy ? 'Reading…' : 'Import observed extent'}
            </Button>
          </>
        )}
      </Section>
    </div>
  );
}

export default function LeftPanel() {
  const open = useUiStore((s) => s.leftOpen);
  const setOpen = useUiStore((s) => s.setLeftOpen);
  const tab = useUiStore((s) => s.leftTab);
  const setTab = useUiStore((s) => s.setLeftTab);
  return (
    <>
      <AnimatePresence initial={false}>
        {open && (
          <motion.aside
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className="glass pointer-events-auto absolute bottom-4 left-4 top-[76px] z-20 flex w-[var(--left-w)] flex-col overflow-hidden rounded-panel shadow-panel"
          >
            <div className="flex items-center gap-2 px-4 pb-3 pt-4">
              <Segmented
                layoutId="left-tabs"
                value={tab}
                onChange={setTab}
                className="flex-1"
                options={[
                  { value: 'event', label: 'Event' },
                  { value: 'model', label: 'Model' },
                  { value: 'observe', label: 'Observe' },
                ]}
              />
              <button onClick={() => setOpen(false)} aria-label="Hide panel" className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-white/[0.08] hover:text-ink">
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>
            <div className="scroll-soft flex-1 overflow-y-auto px-4 pb-6 pt-1">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                  {tab === 'event' && <EventTab />}
                  {tab === 'model' && <ModelTab />}
                  {tab === 'observe' && <ObserveTab />}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="glass pointer-events-auto absolute left-4 top-[76px] z-20 flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium shadow-float"
        >
          Controls <ChevronRight className={cn('h-4 w-4')} />
        </button>
      )}
    </>
  );
}
