'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSimStore } from '@/store/simulationStore';
import { useScenarioStore } from '@/store/scenarioStore';
import { useUiStore } from '@/store/uiStore';
import {
  ARRIVAL_BANDS,
  DEPTH_STEPS,
  DEPTH_TICKS,
  DIFF_MID,
  DIFF_NEG,
  DIFF_POS,
  HAZARD_COLORS,
  IDENTITY,
  VELOCITY_STEPS,
  VELOCITY_TICKS,
  VELOCITY_MAX,
  depthPosition,
  gradientCss,
} from '@/components/map/colormaps';
import { HAZARD_CLASSES } from '@/lib/damage';

function Ramp({ steps, ticks, position, unit }: { steps: string[]; ticks: number[]; position: (v: number) => number; unit: string }) {
  return (
    <div>
      <div className="h-2 rounded-full" style={{ background: gradientCss(steps) }} />
      <div className="relative mt-1 h-3.5">
        {ticks.map((t) => (
          <span key={t} className="tnum absolute -translate-x-1/2 text-[10px] text-muted" style={{ left: `${position(t) * 100}%` }}>
            {t}
          </span>
        ))}
      </div>
      <div className="text-right text-[10px] text-faint">{unit}</div>
    </div>
  );
}

function Swatches({ items }: { items: { color: string; label: string; title?: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-1.5 text-[11px] text-ink-2" title={i.title}>
          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: i.color }} />
          {i.label}
        </div>
      ))}
    </div>
  );
}

const TITLES: Record<string, string> = {
  depth: 'Water depth',
  maxDepth: 'Peak water depth',
  arrival: 'Flood arrival after breach',
  hazard: 'Hazard to people (AIDR)',
  velocity: 'Peak flow velocity',
  difference: 'Depth difference',
};

export default function Legend() {
  const layer = useSimStore((s) => s.view.layer);
  const hasResults = useSimStore((s) => s.runs.swe.frames > 0 || s.runs.sph.frames > 0);
  const observed = useScenarioStore((s) => s.observed);
  const external = useScenarioStore((s) => s.external);
  const bothRan = useSimStore((s) => s.runs.swe.frames > 0 && s.runs.sph.frames > 0);
  const leftOpen = useUiStore((s) => s.leftOpen);

  let body: React.ReactNode = null;
  if (layer === 'depth' || layer === 'maxDepth') body = <Ramp steps={DEPTH_STEPS} ticks={DEPTH_TICKS} position={depthPosition} unit="metres" />;
  else if (layer === 'velocity')
    body = <Ramp steps={VELOCITY_STEPS} ticks={VELOCITY_TICKS} position={(v) => Math.sqrt(v / VELOCITY_MAX)} unit="metres per second" />;
  else if (layer === 'arrival') body = <Swatches items={ARRIVAL_BANDS.map((b) => ({ color: b.color, label: b.label }))} />;
  else if (layer === 'hazard') body = <Swatches items={HAZARD_CLASSES.map((h, i) => ({ color: HAZARD_COLORS[i], label: h.label, title: h.description }))} />;
  else if (layer === 'difference') {
    const compared = bothRan ? 'SPH' : external ? external.name : 'Other';
    body = (
      <div>
        <div className="h-2 rounded-full" style={{ background: gradientCss([...DIFF_NEG, DIFF_MID, ...DIFF_POS]) }} />
        <div className="mt-1 flex justify-between text-[10px] text-muted">
          <span>{compared} shallower</span>
          <span>same</span>
          <span>{compared} deeper</span>
        </div>
      </div>
    );
  }

  return (
    <AnimatePresence>
      {hasResults && body && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="glass pointer-events-auto absolute bottom-[104px] z-10 w-[232px] rounded-2xl px-3.5 py-3 shadow-float transition-[left] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ left: leftOpen ? 392 : 16 }}
        >
          <div className="mb-2 text-[11.5px] font-semibold text-ink">{TITLES[layer]}</div>
          {body}
          {observed && (
            <div className="mt-2.5 flex items-center gap-1.5 border-t border-hairline pt-2 text-[11px] text-ink-2">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: IDENTITY.observed, opacity: 0.6 }} />
              Observed (Sentinel-1)
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
