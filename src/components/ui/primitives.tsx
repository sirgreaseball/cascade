'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

// ---- Hints ----------------------------------------------------------------------------------

/** How long the pointer must rest on something before its explanation appears. */
const HINT_DELAY_MS = 450;

/**
 * An explanation that appears when the pointer rests on a control, the way a file manager explains
 * a file. It is rendered at the top of the page rather than beside the control, so panels that
 * scroll or slide cannot clip it, and it never takes the pointer.
 */
export function Hint({ title, body, children }: { title: React.ReactNode; body?: React.ReactNode; children: React.ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [at, setAt] = useState<{ x: number; y: number; above: boolean } | null>(null);
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setAt(null);
  };
  const show = (e?: React.PointerEvent | React.FocusEvent) => {
    if (e && 'clientX' in e) pointer.current = { x: e.clientX, y: e.clientY };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // The wrapper is `display: contents`, which has no box of its own — asking it where it is
      // returns the top-left corner of the page. Measure the control inside it instead, and fall
      // back to the pointer when the child is a bare string with no element to measure.
      const child = anchor.current?.firstElementChild;
      const r = child?.getBoundingClientRect();
      const box = r && (r.width > 0 || r.height > 0) ? r : null;
      const p = pointer.current;
      if (!box && !p) return;
      const cx = box ? box.left + box.width / 2 : (p as { x: number }).x;
      const under = box ? box.bottom : (p as { y: number }).y + 14;
      const over = box ? box.top : (p as { y: number }).y - 8;
      const above = under + 132 > window.innerHeight;
      setAt({ x: Math.min(Math.max(cx, 150), window.innerWidth - 150), y: above ? over - 10 : under + 10, above });
    }, HINT_DELAY_MS);
  };
  useEffect(() => () => hide(), []);
  return (
    <span ref={anchor} className="contents" onPointerEnter={show} onPointerLeave={hide} onPointerDown={hide} onFocusCapture={show} onBlurCapture={hide}>
      {children}
      {at &&
        typeof document !== 'undefined' &&
        createPortal(
          // Centring lives on this wrapper, not on the animated box: Framer Motion writes `transform`
          // itself, and a translate set beside its animation is thrown away on the first frame.
          <div
            style={{ left: at.x, top: at.y, transform: `translate(-50%, ${at.above ? '-100%' : '0'})` }}
            className="pointer-events-none fixed z-[80]"
          >
            <motion.div
              initial={{ opacity: 0, y: at.above ? 4 : -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
              className="glass-strong max-w-[280px] rounded-xl px-3 py-2 shadow-float"
            >
              <div className="text-[12px] font-semibold leading-snug text-ink">{title}</div>
              {body && <div className="mt-1 text-[11.5px] leading-snug text-muted">{body}</div>}
            </motion.div>
          </div>,
          document.body,
        )}
    </span>
  );
}

// ---- Surfaces -------------------------------------------------------------------------------

export function Panel({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('glass rounded-panel shadow-panel', className)} {...rest}>
      {children}
    </div>
  );
}

export function Section({ title, action, children, className }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3">
          {title && <h3 className="text-[13px] font-semibold text-ink">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px bg-hairline', className)} />;
}

// ---- Buttons --------------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'accent';

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      className={cn(
        'inline-flex select-none items-center justify-center gap-1.5 rounded-full font-medium transition-[background,box-shadow,transform,opacity] duration-200 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100',
        size === 'sm' && 'h-7 px-3 text-[12px]',
        size === 'md' && 'h-9 px-4 text-[13px]',
        size === 'lg' && 'h-11 px-5 text-[15px]',
        variant === 'primary' && 'bg-ink text-canvas hover:bg-white',
        variant === 'accent' && 'bg-accent text-canvas hover:bg-accent-strong',
        variant === 'secondary' && 'bg-white/[0.08] text-ink shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.12)] hover:bg-white/[0.13]',
        variant === 'ghost' && 'text-ink hover:bg-white/[0.07]',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({ className, label, children, active, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-white/[0.08] hover:text-ink',
        active && 'bg-ink text-canvas hover:bg-ink hover:text-canvas',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---- Segmented control (iOS-style, animated thumb) -------------------------------------------

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  className,
  layoutId,
}: {
  value: T;
  options: { value: T; label: React.ReactNode; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  className?: string;
  layoutId?: string;
}) {
  const id = useId();
  return (
    <div role="radiogroup" className={cn('relative flex rounded-[10px] bg-fill p-[2px]', className)}>
      {options.map((o) => {
        const active = o.value === value;
        const button = (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative z-0 flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-[8px] px-2.5 font-medium transition-colors',
              size === 'sm' ? 'h-6 text-[11.5px]' : 'h-7 text-[12.5px]',
              active ? 'text-ink' : 'text-muted hover:text-ink',
              o.disabled && 'opacity-35',
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId ?? `seg-${id}`}
                className="absolute inset-0 -z-10 rounded-[8px] bg-white/[0.16] shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.2),0_2px_8px_rgba(0,0,0,0.35)]"
                transition={{ type: 'spring', stiffness: 520, damping: 40 }}
              />
            )}
            {o.label}
          </button>
        );
        return o.title ? (
          <Hint key={o.value} title={o.label} body={o.title}>
            {button}
          </Hint>
        ) : (
          button
        );
      })}
    </div>
  );
}

// ---- Slider ----------------------------------------------------------------------------------

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  hint,
  tip,
  log = false,
  disabled,
}: {
  label: React.ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: React.ReactNode;
  /** Plain-language explanation shown when the pointer rests on the label. */
  tip?: React.ReactNode;
  log?: boolean;
  disabled?: boolean;
}) {
  // Log sliders map the thumb position logarithmically for values spanning decades.
  const toPos = (v: number) => (log ? (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (v - min) / (max - min));
  const fromPos = (p: number) => {
    const raw = log ? Math.exp(Math.log(min) + p * (Math.log(max) - Math.log(min))) : min + p * (max - min);
    const snapped = Math.round(raw / step) * step;
    return Math.min(max, Math.max(min, Number(snapped.toPrecision(12))));
  };
  const pos = Math.min(1, Math.max(0, toPos(value)));
  return (
    <label className={cn('block', disabled && 'opacity-50')}>
      <div className="mb-0.5 flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] text-ink-2">{tip ? <Hint title={label} body={tip}><span className="cursor-help decoration-white/20 decoration-dotted underline-offset-4 hover:underline">{label}</span></Hint> : label}</span>
        <span className="tnum text-[12.5px] font-medium text-ink">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        className="range"
        min={0}
        max={1000}
        step={1}
        disabled={disabled}
        value={Math.round(pos * 1000)}
        style={{ ['--fill' as string]: `${pos * 100}%` }}
        onChange={(e) => onChange(fromPos(Number(e.target.value) / 1000))}
      />
      {hint && <div className="mt-0.5 text-[11px] leading-snug text-faint">{hint}</div>}
    </label>
  );
}

// ---- Switch ----------------------------------------------------------------------------------

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-good' : 'bg-fill-2', disabled && 'opacity-40')}
    >
      <motion.span
        className="absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-knob"
        animate={{ left: checked ? 18 : 2 }}
        transition={{ type: 'spring', stiffness: 600, damping: 38 }}
      />
    </button>
  );
}

// ---- Figures ---------------------------------------------------------------------------------

/** How long a figure takes to travel from its old value to its new one. */
const COUNT_MS = 420;

/**
 * A figure that counts to its new value instead of snapping. Headline numbers change every time the
 * flood reaches another settlement, and a number that jumps is read as a glitch rather than as the
 * water arriving somewhere.
 */
export function Count({ value, format, className }: { value: number; format: (v: number) => React.ReactNode; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const b = value;
    if (a === b) return;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_MS);
      // Ease out: quick off the mark, gentle as it lands.
      const eased = 1 - (1 - t) ** 3;
      const at = a + (b - a) * eased;
      from.current = at;
      setShown(at);
      if (t < 1) raf.current = requestAnimationFrame(step);
      else from.current = b;
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value]);
  return <span className={className}>{format(shown)}</span>;
}

export function Stat({ label, value, sub, className }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="truncate text-[11.5px] text-muted">{label}</div>
      <div className="mt-0.5 truncate text-[19px] font-semibold leading-tight tracking-[-0.02em] text-ink">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

export function Progress({ value, color = 'var(--color-ink)', className }: { value: number; color?: string; className?: string }) {
  return (
    <div className={cn('h-1 overflow-hidden rounded-full bg-fill-2', className)}>
      <div className="h-full rounded-full transition-[width] duration-300 ease-out" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: color }} />
    </div>
  );
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', className)} style={{ background: color }} />;
}

export function Tag({ children, className, tone = 'neutral' }: { children: React.ReactNode; className?: string; tone?: 'neutral' | 'accent' | 'warning' }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-medium',
        tone === 'neutral' && 'bg-fill text-muted',
        tone === 'accent' && 'bg-accent/10 text-accent',
        tone === 'warning' && 'bg-warning/15 text-warning',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Field({ label, children, hint, tip }: { label: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode; tip?: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[12px] text-ink-2">
        {tip ? (
          <Hint title={label} body={tip}>
            <span className="cursor-help decoration-white/20 decoration-dotted underline-offset-4 hover:underline">{label}</span>
          </Hint>
        ) : (
          label
        )}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export function TextInput({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'tnum h-9 w-full rounded-[10px] bg-fill px-3 text-[13px] text-ink outline-none transition-shadow placeholder:text-faint focus:bg-white/[0.1] focus:shadow-[0_0_0_2px_var(--color-accent)]',
        className,
      )}
      {...rest}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4 animate-spin text-muted', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
