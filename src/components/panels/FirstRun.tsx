'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useScenarioStore } from '@/store/scenarioStore';
import { useUiStore } from '@/store/uiStore';

/** Bumped when the tour changes enough that people who have seen the old one should see it again. */
const SEEN_KEY = 'cascade.tour.v1';

/**
 * The four things somebody meeting Cascade for the first time needs to find. Each points at a real
 * control by its `data-coach` name; a step whose control is not on screen is skipped, so the tour
 * still makes sense on a narrow window where the side panels start closed.
 */
const STEPS = [
  {
    at: 'left',
    title: 'Describe the failure',
    body: 'Which dam, how much water it holds, how wide the breach cuts and how fast. Every setting explains itself if you rest the pointer on it.',
  },
  {
    at: 'run',
    title: 'Run both solvers',
    body: 'A shallow-water grid and a particle model compute the same flood two different ways. Where they agree, the answer is solid.',
  },
  {
    at: 'timeline',
    title: 'Follow the water',
    body: 'Scrub through the hours after the breach. The map redraws at whatever moment you stop on.',
  },
  {
    at: 'right',
    title: 'Read what it costs',
    body: 'People, buildings, bridges and roads reached by the water, counted as the flood advances. Rest the pointer on a figure to see how it was worked out.',
  },
] as const;

/** Where the card sits relative to the thing it points at. */
function place(r: DOMRect) {
  const W = 320;
  const M = 14;
  if (r.bottom > window.innerHeight - 160) {
    return { left: Math.min(Math.max(r.left + r.width / 2 - W / 2, M), window.innerWidth - W - M), top: r.top - M, translate: '0, -100%' };
  }
  if (r.left > window.innerWidth / 2) return { left: r.left - W - M, top: r.top + 8, translate: '0, 0' };
  return { left: r.right + M, top: r.top + 8, translate: '0, 0' };
}

export default function FirstRun() {
  const ready = useScenarioStore((s) => s.status) === 'ready';
  const mapReady = useUiStore((s) => s.mapReady);
  const [step, setStep] = useState(-1);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Start once the map is actually up, so the tour never points at a control behind the veil.
  useEffect(() => {
    if (!ready || !mapReady || step !== -1) return;
    let seen = true;
    try {
      seen = localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      // Private browsing: show the tour rather than fail.
      seen = false;
    }
    if (seen) return;
    const t = setTimeout(() => setStep(0), 900);
    return () => clearTimeout(t);
  }, [ready, mapReady, step]);

  // Panels slide and the window resizes, so the spotlight follows its control every frame.
  useEffect(() => {
    if (step < 0 || step >= STEPS.length) return;
    let raf = 0;
    const follow = () => {
      const el = document.querySelector(`[data-coach="${STEPS[step].at}"]`);
      const r = el?.getBoundingClientRect() ?? null;
      setRect((prev) => (prev && r && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height ? prev : r));
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  const end = () => {
    setStep(STEPS.length);
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Nothing to remember it with; the tour will simply offer itself again.
    }
  };
  const next = () => {
    // Skip past any step whose control this window does not show.
    let n = step + 1;
    while (n < STEPS.length && !document.querySelector(`[data-coach="${STEPS[n].at}"]`)) n++;
    if (n >= STEPS.length) end();
    else setStep(n);
  };

  useEffect(() => {
    if (step < 0 || step >= STEPS.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') end();
      if (e.key === 'Enter' || e.key === ' ') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const active = step >= 0 && step < STEPS.length && rect;
  const s = active ? STEPS[step] : null;
  const pos = active && rect ? place(rect) : null;
  return (
    <AnimatePresence>
      {active && rect && s && pos && (
        <motion.div
          key="tour"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="pointer-events-none fixed inset-0 z-[70]"
        >
          {/* The dimmed page, with a hole cut around the control being described. */}
          <motion.div
            className="absolute rounded-[22px]"
            animate={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}
            transition={{ type: 'spring', stiffness: 380, damping: 40 }}
            style={{ boxShadow: '0 0 0 9999px rgba(8,10,14,0.62), inset 0 0 0 1.5px rgba(245,166,35,0.75)' }}
          />
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            style={{ left: pos.left, top: pos.top, width: 320, transform: `translate(${pos.translate})` }}
            className="glass-strong pointer-events-auto absolute rounded-2xl p-4 shadow-float"
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
                Step {step + 1} of {STEPS.length}
              </span>
            </div>
            <div className="mt-1.5 text-[15px] font-semibold tracking-[-0.01em]">{s.title}</div>
            <p className="mt-1 text-[12.5px] leading-snug text-muted">{s.body}</p>
            <div className="mt-3.5 flex items-center justify-between">
              <button onClick={end} className="text-[12px] font-medium text-faint transition-colors hover:text-ink">
                Skip
              </button>
              <button onClick={next} className="rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-semibold text-canvas transition-transform active:scale-95">
                {step === STEPS.length - 1 ? 'Got it' : 'Next'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
