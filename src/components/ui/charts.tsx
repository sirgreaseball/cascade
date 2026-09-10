'use client';

// Minimal SVG line/area chart: one y-axis, hairline grid, 2px lines, a 10% area wash, a legend
// for two or more series, and a crosshair tooltip. Values are also shown in text elsewhere
// (stat tiles / tables), so the tooltip enhances rather than gates.

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  points: [number, number][];
  area?: boolean;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(300);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return n * p;
}

function valueAt(points: [number, number][], x: number): number | null {
  if (points.length === 0 || x < points[0][0] - 1e-9 || x > points[points.length - 1][0] + 1e-9) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= x) lo = mid;
    else hi = mid;
  }
  const [x0, y0] = points[lo];
  const [x1, y1] = points[hi];
  return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

export function LineChart({
  series,
  xMax,
  height = 132,
  yFormat,
  xFormat,
  marker,
}: {
  series: ChartSeries[];
  xMax: number;
  height?: number;
  yFormat: (v: number) => string;
  xFormat: (v: number) => string;
  marker?: number | null;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 44;
  const padR = 6;
  const padT = 6;
  const padB = 18;
  const iw = Math.max(10, width - padL - padR);
  const ih = height - padT - padB;
  const yMax = useMemo(() => niceMax(Math.max(0, ...series.flatMap((s) => s.points.map((p) => p[1]))) * 1.04), [series]);
  const sx = (x: number) => padL + (Math.min(x, xMax) / xMax) * iw;
  const sy = (y: number) => padT + ih - (y / yMax) * ih;
  const hourStep = xMax <= 2 * 3600 ? 1800 : xMax <= 8 * 3600 ? 3600 : 7200;
  const xTicks: number[] = [];
  for (let t = 0; t <= xMax + 1; t += hourStep) xTicks.push(t);

  const path = (pts: [number, number][]) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join(' ');
  const area = (pts: [number, number][]) =>
    pts.length > 1 ? `${path(pts)} L${sx(pts[pts.length - 1][0]).toFixed(1)} ${sy(0)} L${sx(pts[0][0]).toFixed(1)} ${sy(0)} Z` : '';

  const hoverValues = hover === null ? [] : series.map((s) => ({ s, v: valueAt(s.points, hover) })).filter((h) => h.v !== null);

  return (
    <div>
      {series.length > 1 && (
        <div className="mb-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {series.map((s) => (
            <span key={s.id} className="flex items-center gap-1.5 text-[11px] text-ink-2">
              <span className="h-[2px] w-3 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div ref={ref} className="relative">
        <svg
          width={width}
          height={height}
          className="block overflow-visible"
          onPointerMove={(e) => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const x = ((e.clientX - rect.left - padL) / iw) * xMax;
            setHover(x >= 0 && x <= xMax ? x : null);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={padL} x2={padL + iw} y1={sy(yMax * f)} y2={sy(yMax * f)} stroke={f === 0 ? '#c3c2b7' : '#e8e8ea'} strokeWidth={1} />
              <text x={padL - 6} y={sy(yMax * f) + 3.5} textAnchor="end" className="tnum fill-[#86868b] text-[10px]">
                {yFormat(yMax * f)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={sx(t)} y={height - 4} textAnchor="middle" className="tnum fill-[#86868b] text-[10px]">
              {xFormat(t)}
            </text>
          ))}
          {series.map((s) => s.area && <path key={`a-${s.id}`} d={area(s.points)} fill={s.color} fillOpacity={0.1} />)}
          {series.map((s) => (
            <path key={s.id} d={path(s.points)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {marker !== null && marker !== undefined && marker <= xMax && (
            <line x1={sx(marker)} x2={sx(marker)} y1={padT} y2={padT + ih} stroke="#1d1d1f" strokeWidth={1} />
          )}
          {hover !== null && (
            <g>
              <line x1={sx(hover)} x2={sx(hover)} y1={padT} y2={padT + ih} stroke="#1d1d1f" strokeOpacity={0.35} strokeWidth={1} />
              {hoverValues.map(({ s, v }) => (
                <circle key={s.id} cx={sx(hover)} cy={sy(v as number)} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>
        {hover !== null && hoverValues.length > 0 && (
          <div
            className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-lg bg-ink px-2 py-1.5 text-[11px] text-white shadow-float"
            style={{ left: Math.min(sx(hover) + 10, width - 150) }}
          >
            <div className="tnum text-white/60">{xFormat(hover)}</div>
            {hoverValues.map(({ s, v }) => (
              <div key={s.id} className="tnum flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                {series.length > 1 && <span className="text-white/70">{s.label}</span>}
                {yFormat(v as number)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
