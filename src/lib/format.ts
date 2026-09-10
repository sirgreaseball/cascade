// Display formatting. Numbers are rounded for reading, never for computation.

const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

export function formatNumber(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '—';
  return digits === 0 ? nf0.format(n) : new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits }).format(n);
}

/** 1,284 · 12.9K · 4.2M */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `${nf1.format(n / 1e9)}B`;
  if (a >= 1e6) return `${nf1.format(n / 1e6)}M`;
  if (a >= 1e4) return `${nf1.format(n / 1e3)}K`;
  return nf0.format(n);
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h} h` : `${h} h ${mm} min`;
}

/** Elapsed time as h:mm:ss (or m:ss under an hour). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (v: number) => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function formatArea(m2: number): string {
  if (!Number.isFinite(m2)) return '—';
  if (m2 >= 1e6) return `${nf1.format(m2 / 1e6)} km²`;
  return `${nf0.format(m2 / 1e4)} ha`;
}

export function formatVolume(m3: number): string {
  if (!Number.isFinite(m3)) return '—';
  if (m3 >= 1e9) return `${(m3 / 1e9).toFixed(2)} km³`;
  if (m3 >= 1e6) return `${nf1.format(m3 / 1e6)} Mm³`;
  return `${nf0.format(m3)} m³`;
}

export function formatDischarge(q: number): string {
  if (!Number.isFinite(q)) return '—';
  return `${formatCompact(q)} m³/s`;
}

export function formatDepth(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return '—';
  if (m < 1) return `${Math.round(m * 100)} cm`;
  return `${m < 10 ? m.toFixed(1) : nf0.format(m)} m`;
}

export function formatSpeed(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—';
  return `${v.toFixed(1)} m/s`;
}

/** Indian notation: ₹ lakh / crore. */
export function formatINR(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '₹0';
  if (amount >= 1e7) {
    const cr = amount / 1e7;
    return `₹${cr >= 100 ? nf0.format(cr) : nf1.format(cr)} Cr`;
  }
  if (amount >= 1e5) return `₹${nf1.format(amount / 1e5)} L`;
  return `₹${nf0.format(amount)}`;
}

export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '—';
  return m >= 1000 ? `${nf1.format(m / 1000)} km` : `${nf0.format(m)} m`;
}
