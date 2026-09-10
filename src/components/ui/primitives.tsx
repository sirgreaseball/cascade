'use client';

import React, { useId } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

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
        variant === 'primary' && 'bg-ink text-white hover:bg-black',
        variant === 'accent' && 'bg-accent text-white hover:bg-accent-strong',
        variant === 'secondary' && 'bg-white text-ink shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.06)] hover:bg-[#fafafa]',
        variant === 'ghost' && 'text-ink hover:bg-black/[0.05]',
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
        'inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-black/[0.06] hover:text-ink',
        active && 'bg-ink text-white hover:bg-ink hover:text-white',
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
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            title={o.title}
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
                className="absolute inset-0 -z-10 rounded-[8px] bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.1)]"
                transition={{ type: 'spring', stiffness: 520, damping: 40 }}
              />
            )}
            {o.label}
          </button>
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
        <span className="text-[12.5px] text-ink-2">{label}</span>
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
        tone === 'warning' && 'bg-[#fff4e0] text-[#8a5a00]',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Field({ label, children, hint }: { label: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[12px] text-ink-2">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export function TextInput({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'tnum h-9 w-full rounded-[10px] bg-fill px-3 text-[13px] text-ink outline-none transition-shadow placeholder:text-faint focus:bg-white focus:shadow-[0_0_0_2px_var(--color-accent)]',
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
