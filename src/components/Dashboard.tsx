'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { lastScenarioId, useScenarioStore } from '@/store/scenarioStore';
import { useSimStore } from '@/store/simulationStore';
import { useUiStore } from '@/store/uiStore';
import { results } from '@/simulation/results';
import { latestTime } from './useSimView';
import TopBar, { Logo } from './panels/TopBar';
import Timeline from './panels/Timeline';
import Legend from './panels/Legend';
import LeftPanel from './panels/LeftPanel';
import RightPanel from './panels/RightPanel';
import ScenarioBuilder from './panels/ScenarioBuilder';
import ExportSheet from './panels/ExportSheet';
import { cn } from '@/lib/utils';

const MapView = dynamic(() => import('./map/MapView'), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[#e9ecee]" />,
});

/** Loads the scenario list and opens the last-used (or first) scenario. */
function useBoot() {
  useEffect(() => {
    const { loadIndex, select } = useScenarioStore.getState();
    loadIndex().then((index) => {
      if (index.length === 0) return;
      const last = lastScenarioId();
      select(index.some((s) => s.id === last) ? (last as string) : index[0].id);
    });
  }, []);
}

/** Advances the playhead: follows the live computation, or plays back at the chosen speed. */
function usePlayback() {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const s = useSimStore.getState();
      const latest = latestTime();
      if (s.follow) {
        if (latest > 0 && Math.abs(latest - s.playhead) > 0.5) {
          // Ease towards the newest frame so the flood front glides instead of jumping.
          const next = s.playhead + (latest - s.playhead) * (1 - Math.exp(-dt * 3.5));
          s.setPlayhead(Math.min(next, latest));
        }
      } else if (s.playing) {
        let t = s.playhead + dt * s.speed;
        const anyRunning = s.runs.swe.status === 'running' || s.runs.sph.status === 'running';
        if (t >= latest) {
          t = latest;
          if (!anyRunning) s.setPlaying(false);
        }
        s.setPlayhead(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

/** Space plays / pauses; Escape closes whatever sheet or mode is open. */
function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.key === 'Escape') {
        const ui = useUiStore.getState();
        if (ui.pickingDam) ui.setPickingDam(false);
        else if (ui.exportOpen) ui.setExportOpen(false);
        else if (useScenarioStore.getState().builderOpen) useScenarioStore.getState().setBuilderOpen(false);
        else useSimStore.getState().selectAsset(null);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space' && !(el && el.tagName === 'BUTTON')) {
        e.preventDefault();
        useSimStore.getState().togglePlayback();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Start with side panels tucked away on narrower windows so the map keeps room. */
function useResponsiveStart() {
  useEffect(() => {
    const w = window.innerWidth;
    if (w < 1200) useUiStore.getState().setRightOpen(false);
    if (w < 960) useUiStore.getState().setLeftOpen(false);
  }, []);
}

function SmallScreenNotice() {
  const [show, setShow] = React.useState(false);
  useEffect(() => setShow(window.innerWidth < 760), []);
  if (!show) return null;
  return (
    <div className="absolute inset-0 z-[60] flex items-end justify-center bg-black/25 p-4 backdrop-blur-sm">
      <div className="glass-strong w-full max-w-sm rounded-[26px] p-6 shadow-panel">
        <Logo className="h-9 w-9" />
        <div className="mt-4 text-[17px] font-semibold tracking-[-0.02em]">Cascade is built for bigger screens</div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">The simulator runs two hydrodynamic solvers and a 3D map side by side. It works best on a laptop or desktop.</p>
        <button onClick={() => setShow(false)} className="mt-5 h-10 w-full rounded-full bg-ink text-[14px] font-medium text-white">
          Continue anyway
        </button>
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismiss);
  return (
    <div className="pointer-events-none absolute left-1/2 top-[76px] z-50 flex w-[360px] -translate-x-1/2 flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className={cn('glass-strong pointer-events-auto flex items-start gap-3 rounded-2xl px-4 py-3 shadow-float', t.tone === 'error' && 'ring-1 ring-critical/30')}
          >
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-ink">{t.title}</div>
              {t.body && <div className="mt-0.5 text-[12px] leading-snug text-muted">{t.body}</div>}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-faint hover:text-ink" aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

const LOADING_STEPS = ['Starting Cascade', 'Loading the scenario', 'Drawing the terrain', 'Ready'];
/** On first load the loading screen stays at least this long, so it never just flashes… */
const MIN_VEIL_MS = 1800;
/** …and stops waiting for the map after this long (slow tiles, offline). */
const MAX_VEIL_MS = 9000;
const EASE = [0.22, 1, 0.36, 1] as const;
const WAVES = [
  'M7 12.5c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.3-2 4.5-2 2.3 2 4.5 2',
  'M7 17c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.3-2 4.5-2 2.3 2 4.5 2',
  'M7 21.5c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.3-2 4.5-2 2.3 2 4.5 2',
];

/** The logo, its three waves dimming in turn like water running over a weir. */
function AnimatedLogo() {
  return (
    <motion.svg
      viewBox="0 0 32 32"
      className="h-14 w-14 shadow-float [border-radius:16px]"
      aria-hidden
      animate={{ y: [0, -3, 0] }}
      transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
    >
      <rect width="32" height="32" rx="9" fill="#1d1d1f" />
      {WAVES.map((d, i) => {
        const base = 1 - i * 0.28;
        return (
          <motion.path
            key={d}
            d={d}
            stroke="#fff"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            initial={{ opacity: base }}
            animate={{ opacity: [base, base * 0.3, base] }}
            transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.25, ease: 'easeInOut' }}
          />
        );
      })}
    </motion.svg>
  );
}

function LoadingVeil() {
  const status = useScenarioStore((s) => s.status);
  const error = useScenarioStore((s) => s.error);
  const index = useScenarioStore((s) => s.index);
  const select = useScenarioStore((s) => s.select);
  const mapReady = useUiStore((s) => s.mapReady);
  const [minElapsed, setMinElapsed] = useState(false);
  const [waitedEnough, setWaitedEnough] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setMinElapsed(true), MIN_VEIL_MS);
    const b = setTimeout(() => setWaitedEnough(true), MAX_VEIL_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);
  // Both conditions only ever become true, so after the first load this stays false and a
  // scenario switch shows the lighter, translucent version.
  const booting = !(minElapsed && (mapReady || waitedEnough));
  const show = status === 'loading' || status === 'error' || status === 'idle' || (status === 'ready' && booting);
  const step = status === 'ready' ? (mapReady ? 3 : 2) : status === 'loading' ? 1 : 0;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="veil"
          // Painted opaque from the first frame (no fade-in), so it can never flash.
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.015, filter: 'blur(4px)' }}
          transition={{ duration: 0.7, ease: EASE }}
          className={cn('absolute inset-0 z-40 flex items-center justify-center', booting ? 'bg-canvas' : 'bg-canvas/70 backdrop-blur-md')}
        >
          {status === 'error' ? (
            <div className="glass-strong max-w-sm rounded-panel p-6 text-center shadow-panel">
              <div className="text-[15px] font-semibold">Couldn’t open this scenario</div>
              <p className="mt-1.5 text-[13px] text-muted">{error}</p>
              {index[0] && (
                <button className="mt-4 text-[13px] font-medium text-accent" onClick={() => select(index[0].id)}>
                  Open {index[0].name}
                </button>
              )}
            </div>
          ) : (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} className="flex flex-col items-center gap-4">
              <AnimatedLogo />
              <div className="text-[19px] font-semibold tracking-[-0.02em]">Cascade</div>
              <div className="h-[3px] w-44 overflow-hidden rounded-full bg-black/[0.07]">
                <motion.div
                  className="h-full rounded-full bg-ink"
                  initial={{ width: '8%' }}
                  animate={{ width: `${((step + 1) / LOADING_STEPS.length) * 100}%` }}
                  transition={{ duration: 0.9, ease: EASE }}
                />
              </div>
              <div className="relative h-4 w-60 text-center text-[12.5px] text-muted">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={step}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.25 }}
                    className="absolute inset-0"
                  >
                    {LOADING_STEPS[step]}
                    {step < LOADING_STEPS.length - 1 ? '…' : ''}
                  </motion.span>
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function Dashboard() {
  useBoot();
  usePlayback();
  useKeyboard();
  useResponsiveStart();
  // Drop frames from a previous session's run when this component unmounts (route change).
  useEffect(() => () => results.clear(), []);
  return (
    <main className="relative h-dvh w-screen select-none overflow-hidden bg-canvas text-ink">
      <MapView />
      <TopBar />
      <LeftPanel />
      <RightPanel />
      <Timeline />
      <Legend />
      <Toasts />
      <ScenarioBuilder />
      <ExportSheet />
      <LoadingVeil />
      <SmallScreenNotice />
    </main>
  );
}
