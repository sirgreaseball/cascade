// Loss of life among the population at risk, after Graham (1999), "A Procedure for Estimating
// Loss of Life Caused by Dam Failure", US Bureau of Reclamation, DSO-99-06. The fatality rate
// depends on flood severity and warning time. Understanding of the flood is taken as "vague",
// the conservative choice for communities that have never seen a dam-break flood, and the
// warning is assumed to go out as the breach begins, so a place's warning time is its arrival
// time. Indicative only: it does not model evacuation, shelter or time of day.

export type Severity = 'low' | 'medium' | 'high';
export type Warning = 'none' | 'some' | 'adequate';

/** [low, suggested, high] fatality rates, Graham (1999) Table 5, understanding "vague". */
const RATES: Record<Exclude<Severity, 'high'>, Record<Warning, [number, number, number]>> = {
  medium: { none: [0.03, 0.15, 0.35], some: [0.01, 0.04, 0.08], adequate: [0.005, 0.03, 0.06] },
  low: { none: [0, 0.01, 0.02], some: [0, 0.007, 0.015], adequate: [0, 0.0003, 0.0006] },
};
const HIGH: [number, number, number] = [0.3, 0.75, 1];

/** Depth × velocity (m²/s) above which Graham's medium severity applies (50 ft²/s). */
export const MEDIUM_DV = 4.6;
/** Depth × velocity (m²/s) at which masonry and concrete buildings collapse (RESCDAM). */
export const HIGH_DV = 12;

export function warningClass(seconds: number): Warning {
  if (seconds < 15 * 60) return 'none';
  return seconds < 60 * 60 ? 'some' : 'adequate';
}

/**
 * Fatality rate for a place reached `warningSeconds` after the breach with a peak depth ×
 * velocity of `dv`. High severity (the flood sweeps the area clean) applies only where buildings
 * collapse before a warning could help; with 15 minutes or more people can reach refuge, so
 * such places are treated as medium severity.
 */
export function grahamFatalityRate(dv: number, warningSeconds: number): { severity: Severity; warning: Warning; low: number; rate: number; high: number } {
  const warning = warningClass(Math.max(0, warningSeconds));
  const severity: Severity = dv >= HIGH_DV && warning === 'none' ? 'high' : dv >= MEDIUM_DV ? 'medium' : 'low';
  const [low, rate, high] = severity === 'high' ? HIGH : RATES[severity][warning];
  return { severity, warning, low, rate, high };
}
