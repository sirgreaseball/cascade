'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Square } from 'lucide-react';
import { useSimStore, isRunning } from '@/store/simulationStore';
import { useUiStore } from '@/store/uiStore';
import { controller } from '@/simulation/controller';
import { results } from '@/simulation/results';
import { formatClock, formatDischarge, formatDuration } from '@/lib/format';
import { Button, Dot, Segmented } from '@/components/ui/primitives';
import { IDENTITY } from '@/components/map/colormaps';
import { useLatestTime, usePrimaryEngine } from '@/components/useSimView';
import { cn } from '@/lib/utils';

const W = 1000;
const H = 44;

function areaPath(t: number[], q: number[], duration: number, qMax: number): string {
  if (t.length < 2 || qMax <= 0) return '';
  let d = `M0 ${H}`;
  for (let i = 0; i < t.length; i++) {
    if (t[i] > duration) break;
    d += ` L${((t[i] / duration) * W).toFixed(1)} ${(H - (q[i] / qMax) * (H - 4)).toFixed(1)}`;
  }
  const lastT = Math.min(t[t.length - 1], duration);
  return `${d} L${((lastT / duration) * W).toFixed(1)} ${H} Z`;
}

export default function Timeline() {
  const setup = useSimStore((s) => s.setup);
  const duration = useSimStore((s) => s.duration);
  const playhead = useSimStore((s) => s.playhead);
  const playing = useSimStore((s) => s.playing);
  const follow = useSimStore((s) => s.follow);
  const speed = useSimStore((s) => s.speed);
  const runs = useSimStore((s) => s.runs);
  const engines = useSimStore((s) => s.engines);
  const stale = useSimStore((s) => s.stale);
  const version = useSimStore((s) => s.resultsVersion);
  const leftOpen = useUiStore((s) => s.leftOpen);
  const rightOpen = useUiStore((s) => s.rightOpen);
  const latest = useLatestTime();
  const primary = usePrimaryEngine();
  const running = isRunning(runs);
  const hasResults = runs.swe.frames > 0 || runs.sph.frames > 0;
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const series = useMemo(() => {
    void version;
    const r = results.get(primary);
    if (r && r.stats.length > 1) return { t: r.times, q: r.stats.map((s) => s.inflowRate), modelled: true };
    if (setup) return { t: setup.hydrograph.t, q: setup.hydrograph.q, modelled: false };
    return null;
  }, [setup, primary, version]);
  const qMax = useMemo(() => {
    const preview = setup ? setup.hydrograph.peak : 0;
    return Math.max(preview, ...(series?.q ?? [0])) * 1.05;
  }, [series, setup]);

  const seek = (clientX: number) => {
    const el = trackRef.current;
    if (!el || !hasResults) return;
    const rect = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const s = useSimStore.getState();
    s.setFollow(false);
    s.setPlayhead(Math.min(f * duration, latest));
  };

  const togglePlay = () => {
    const s = useSimStore.getState();
    if (follow || playing) {
      s.setFollow(false);
      s.setPlaying(false);
      return;
    }
    if (s.playhead >= latest - 1 && !running) s.setPlayhead(0);
    s.setPlaying(true);
  };

  const hoverT = hoverX === null ? null : hoverX * duration;
  const hoverQ = useMemo(() => {
    if (hoverT === null || !series) return null;
    const { t, q } = series;
    let i = 0;
    while (i < t.length - 1 && t[i + 1] <= hoverT) i++;
    return q[i];
  }, [hoverT, series]);

  const enabled = (['swe', 'sph'] as const).filter((e) => engines[e]);
  const hours = Math.max(1, Math.round(duration / 3600));
  const ticks = Array.from({ length: hours + 1 }, (_, i) => (i * 3600) / duration).filter((f) => f <= 1.0001);

  return (
    <div
      className="pointer-events-none absolute bottom-4 z-20 transition-[left,right] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={{ left: leftOpen ? 392 : 16, right: rightOpen ? 372 : 16 }}
    >
      <div className="glass pointer-events-auto flex h-[76px] items-center gap-4 rounded-[26px] pl-3 pr-4 shadow-panel">
        {/* Transport */}
        <div className="flex shrink-0 items-center gap-1.5">
          {!hasResults && !running ? (
            <Button variant="primary" size="lg" className="h-12 px-5" disabled={!setup} onClick={() => controller.run()}>
              <Play className="h-4 w-4 fill-current" />
              Run simulation
            </Button>
          ) : (
            <>
              <button
                onClick={togglePlay}
                aria-label={follow || playing ? 'Pause' : 'Play'}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-ink text-white transition-transform active:scale-95"
              >
                {follow || playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
              </button>
              {running ? (
                <button onClick={() => controller.reset()} aria-label="Stop the run" title="Stop the run" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-black/[0.06]">
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : (
                <button
                  onClick={() => controller.run()}
                  aria-label="Run again with the current settings"
                  title={stale ? 'Settings changed — run again' : 'Run again'}
                  className={cn('relative flex h-9 w-9 items-center justify-center rounded-full text-ink-2 hover:bg-black/[0.06]', stale && 'text-accent')}
                >
                  <RotateCcw className="h-4 w-4" />
                  {stale && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" />}
                </button>
              )}
            </>
          )}
        </div>

        {/* Clock */}
        <div className="w-[104px] shrink-0">
          <div className="tnum text-[22px] font-semibold leading-none tracking-[-0.03em]">T+{formatClock(hasResults ? playhead : 0)}</div>
          <div className="mt-1 truncate text-[11px] text-muted">
            {running ? 'Computing…' : hasResults ? `of ${formatDuration(duration)}` : setup ? `${formatDuration(duration)} scenario` : ' '}
          </div>
        </div>

        {/* Scrubber with the breach hydrograph behind it */}
        <div className="relative min-w-0 flex-1 self-stretch py-3">
          <div
            ref={trackRef}
            className={cn('relative h-full', hasResults ? 'cursor-pointer' : 'cursor-default')}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              seek(e.clientX);
            }}
            onPointerMove={(e) => {
              const rect = trackRef.current!.getBoundingClientRect();
              setHoverX(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
              if (e.buttons === 1) seek(e.clientX);
            }}
            onPointerLeave={() => setHoverX(null)}
          >
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-x-0 top-0 h-[calc(100%-14px)] w-full overflow-visible">
              <defs>
                <clipPath id="computed">
                  <rect x="0" y="0" width={(Math.min(latest, duration) / duration) * W} height={H} />
                </clipPath>
              </defs>
              <rect x="0" y={H - 0.5} width={W} height="1" fill="rgba(0,0,0,0.12)" />
              {series && <path d={areaPath(series.t, series.q, duration, qMax)} fill="rgba(0,0,0,0.07)" />}
              {series && hasResults && <path d={areaPath(series.t, series.q, duration, qMax)} fill={IDENTITY.swe} fillOpacity={0.22} clipPath="url(#computed)" />}
            </svg>
            {/* Hour ticks */}
            <div className="absolute inset-x-0 bottom-0 h-3">
              {ticks.map((f, i) => (
                <span key={i} className="tnum absolute -translate-x-1/2 text-[9.5px] text-faint" style={{ left: `${f * 100}%` }}>
                  {i}h
                </span>
              ))}
            </div>
            {hasResults && (
              <div className="pointer-events-none absolute top-0 h-[calc(100%-14px)]" style={{ left: `${(Math.min(playhead, duration) / duration) * 100}%` }}>
                <div className="absolute -left-px top-0 h-full w-[2px] rounded-full bg-ink" />
                <div className="absolute -left-[5px] -top-[3px] h-[10px] w-[10px] rounded-full bg-ink ring-2 ring-white" />
              </div>
            )}
            {hoverT !== null && (
              <div className="pointer-events-none absolute -top-9 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[11px] text-white" style={{ left: `${hoverX! * 100}%` }}>
                <span className="tnum">T+{formatClock(hoverT)}</span>
                {hoverQ !== null && <span className="tnum text-white/70"> · {formatDischarge(hoverQ)}</span>}
                {series && !series.modelled && <span className="text-white/50"> preview</span>}
              </div>
            )}
          </div>
        </div>

        {/* Engines + speed */}
        <div className="hidden shrink-0 flex-col items-end gap-1.5 lg:flex">
          <div className="flex items-center gap-3">
            {enabled.map((e) => {
              const r = runs[e];
              const label = e === 'swe' ? 'Grid' : 'SPH';
              const state =
                r.status === 'running' || r.status === 'starting'
                  ? `${Math.round(r.progress * 100)}%`
                  : r.status === 'done'
                    ? formatDuration(r.wallMs / 1000)
                    : r.status === 'paused'
                      ? 'Paused'
                      : r.status === 'error'
                        ? 'Error'
                        : 'Ready';
              return (
                <span key={e} className="flex items-center gap-1.5 text-[11.5px]" title={r.error ?? r.label}>
                  <Dot color={e === 'swe' ? IDENTITY.swe : IDENTITY.sph} />
                  <span className="font-medium text-ink">{label}</span>
                  <span className={cn('tnum text-muted', r.status === 'error' && 'text-critical')}>{state}</span>
                </span>
              );
            })}
          </div>
          <Segmented
            size="sm"
            layoutId="speed-seg"
            value={String(speed)}
            onChange={(v) => useSimStore.getState().setSpeed(Number(v))}
            options={[
              { value: '60', label: '1 min/s' },
              { value: '300', label: '5 min/s' },
              { value: '900', label: '15 min/s' },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
