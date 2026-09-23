// A one-page brief, ready to print.
//
// The dashboard is for the person driving the model; this is for the people in the room who need
// the answer on paper — a district magistrate, a control-room duty officer, an exercise umpire.
// Everything on it comes from the same run the map is showing, and the small print at the bottom
// says which assumptions produced the figures, so nobody has to take them on trust.

import type { ExportContext, ExportLayers } from './index';
import { DEPTH_BANDS } from './index';
import type { PolygonFeature } from './polygonize';

export interface BriefMeta {
  /** How the failure was described, as the panel had it. */
  breachWidth: number;
  breachDepth: number;
  formationTime: number;
  waterDepth: number;
  volume: number;
  manning: number;
  cellSize: number;
  damHeight: number;
  peakOutflow: number;
  kind: string;
  /** Lives the model expects a half-hour warning to save, against no warning at all. */
  livesSavedByWarning?: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const clock = (s: number) => `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')} min`;
const num = (v: number, d = 0) => v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const compact = (v: number) => (v >= 1e7 ? `${(v / 1e7).toFixed(1)} cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)} lakh` : num(Math.round(v)));
const inr = (v: number) => (v >= 1e9 ? `₹${(v / 1e9).toFixed(1)} bn` : v >= 1e7 ? `₹${(v / 1e7).toFixed(1)} cr` : `₹${(v / 1e5).toFixed(1)} lakh`);

/** The flood extent drawn to scale, so the page works without a screen beside it. */
function miniMap(ctx: ExportContext, layers: ExportLayers): string {
  const [w, s, e, n] = ctx.grid.bbox;
  const W = 520;
  const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const H = Math.round((W * (n - s)) / ((e - w) * k));
  const X = (lng: number) => ((lng - w) / (e - w)) * W;
  const Y = (lat: number) => ((n - lat) / (n - s)) * H;
  const path = (f: PolygonFeature) =>
    f.geometry.coordinates
      .map((poly) => poly.map((ring) => `M${ring.map(([lng, lat]) => `${X(lng).toFixed(1)} ${Y(lat).toFixed(1)}`).join('L')}Z`).join(''))
      .join('');
  const bands = DEPTH_BANDS.map((b) => b.label);
  const fills = layers.depth
    .slice()
    .sort((a, b) => bands.indexOf(String(a.properties.class)) - bands.indexOf(String(b.properties.class)))
    .map((f) => `<path d="${path(f)}" fill="${esc(String(f.properties.color))}" fill-rule="evenodd" stroke="none"/>`)
    .join('');
  const [[ax, ay], [bx, by]] = ctx.dam.axis;
  const named = layers.places.slice(0, 6).map((p) => ctx.exposure.assets[p.index]);
  const dots = named
    .map((a) => `<circle cx="${X(a.lng).toFixed(1)}" cy="${Y(a.lat).toFixed(1)}" r="3" fill="#111" stroke="#fff" stroke-width="1.2"/>`)
    .join('');
  const labels = named
    .map((a) => `<text x="${(X(a.lng) + 6).toFixed(1)}" y="${(Y(a.lat) + 3.5).toFixed(1)}" font-size="9" fill="#111">${esc(a.name)}</text>`)
    .join('');
  // A scale bar of whichever round number of kilometres fits a quarter of the width.
  const kmPerPx = ((e - w) * 111.32 * k) / W;
  const target = (W / 4) * kmPerPx;
  const step = [1, 2, 5, 10, 20, 50, 100].reduce((best, v) => (Math.abs(v - target) < Math.abs(best - target) ? v : best), 1);
  const barPx = step / kmPerPx;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="background:#eef2f6;border:1px solid #cfd8e3;border-radius:6px">
  <rect width="${W}" height="${H}" fill="#eef2f6"/>${fills}
  <line x1="${X(ax).toFixed(1)}" y1="${Y(ay).toFixed(1)}" x2="${X(bx).toFixed(1)}" y2="${Y(by).toFixed(1)}" stroke="#d03b3b" stroke-width="3"/>
  ${dots}${labels}
  <g transform="translate(12 ${H - 14})"><line x1="0" y1="0" x2="${barPx.toFixed(1)}" y2="0" stroke="#111" stroke-width="2"/>
  <text x="${(barPx / 2).toFixed(1)}" y="-4" font-size="9" text-anchor="middle" fill="#111">${step} km</text></g>
</svg>`;
}

/** The whole page: a self-contained HTML document with no external anything. */
export function exportBrief(ctx: ExportContext, layers: ExportLayers, meta: BriefMeta): string {
  const i = ctx.impact;
  const when = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const rows = layers.places
    .slice(0, 9)
    .map((p) => {
      const a = ctx.exposure.assets[p.index];
      const st = p.status;
      return `<tr><td>${esc(a.name)}</td><td class="n">${num(a.distanceKm, 1)}</td><td class="n">${st.arrival >= 0 ? clock(st.arrival) : '—'}</td><td class="n">${num(st.maxDepth, 1)} m</td><td class="n">${st.hazard ? `H${st.hazard}` : '—'}</td><td class="n">${compact(st.peopleExposed)}</td></tr>`;
    })
    .join('');
  const figures: [string, string, string][] = [
    ['People in flooded places', compact(i.peopleExposed), `in ${num(i.settlementsFlooded)} settlement${i.settlementsFlooded === 1 ? '' : 's'}`],
    ['Estimated loss of life', i.lossOfLife < 1 ? '< 1' : num(Math.round(i.lossOfLife)), `range ${i.lossOfLifeLow < 1 ? '<1' : num(Math.round(i.lossOfLifeLow))}–${num(Math.round(i.lossOfLifeHigh))}, warning at the breach`],
    ['Critical facilities flooded', num(i.facilitiesFlooded), 'health, schools, emergency'],
    ['Bridges under water', num(i.bridgesFlooded), `${num(i.roadKmCut, i.roadKmCut < 10 ? 1 : 0)} km of major road cut`],
    ['Indicative damage', inr(i.loss), 'JRC depth–damage curves'],
    ['Peak outflow', `${num(Math.round(meta.peakOutflow))} m³/s`, `first water at ${i.firstArrival != null ? clock(i.firstArrival) : '—'}`],
  ];
  const cards = figures
    .map(([label, value, sub]) => `<div class="fig"><div class="lbl">${esc(label)}</div><div class="val">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`)
    .join('');
  const saved =
    meta.livesSavedByWarning && meta.livesSavedByWarning >= 1
      ? `<p class="note"><strong>Warning matters.</strong> Issuing the warning 30 minutes before the breach rather than at the breach lowers the estimate by about ${num(Math.round(meta.livesSavedByWarning))} lives, by Graham's (1999) rates.</p>`
      : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Cascade brief — ${esc(ctx.scenarioName)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 11px/1.45 "Segoe UI", Inter, system-ui, sans-serif; color: #111; background: #fff; }
  .page { max-width: 186mm; margin: 0 auto; }
  header { border-bottom: 2px solid #111; padding-bottom: 6px; display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; }
  h1 { font-size: 17px; margin: 0; letter-spacing: -0.01em; }
  .sub2 { color: #555; font-size: 10.5px; margin-top: 2px; }
  .stamp { border: 1.5px solid #b3261e; color: #b3261e; font-weight: 700; font-size: 9.5px; letter-spacing: .06em; padding: 3px 7px; border-radius: 4px; white-space: nowrap; }
  .figs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; margin: 9px 0; }
  .fig { border: 1px solid #dde3ea; border-radius: 6px; padding: 6px 8px; }
  .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: #667; }
  .val { font-size: 19px; font-weight: 700; letter-spacing: -0.02em; margin-top: 1px; }
  .sub { font-size: 9px; color: #667; }
  .cols { display: grid; grid-template-columns: 1.15fr 1fr; gap: 12px; align-items: start; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #445; margin: 0 0 4px; }
  table { border-collapse: collapse; width: 100%; font-size: 10px; }
  th { text-align: left; border-bottom: 1px solid #111; padding: 2px 3px; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #445; }
  td { border-bottom: 1px solid #eceff3; padding: 2.5px 3px; }
  td.n { text-align: right; white-space: nowrap; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px; font-size: 9px; color: #445; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 3px; vertical-align: -1px; }
  .note { font-size: 9.5px; color: #333; border-left: 2px solid #f5a623; padding-left: 6px; margin: 8px 0 0; }
  footer { margin-top: 10px; border-top: 1px solid #dde3ea; padding-top: 6px; font-size: 8.7px; color: #556; }
  footer b { color: #111; }
  @media print { .noprint { display: none; } }
  .noprint { position: fixed; right: 10px; top: 10px; }
  .noprint button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid #111; background: #111; color: #fff; cursor: pointer; }
</style></head><body><div class="page">
<div class="noprint"><button onclick="window.print()">Print / save as PDF</button></div>
<header>
  <div><h1>${esc(ctx.scenarioName)} — dam-break flood brief</h1>
  <div class="sub2">${esc(meta.kind)} at ${esc(ctx.dam.name)} · ${esc(ctx.engineLabel)} · ${clock(ctx.simulatedSeconds)} simulated · prepared ${esc(when)}</div></div>
  <div class="stamp">EXERCISE — NOT A WARNING</div>
</header>
<div class="figs">${cards}</div>
<div class="cols">
  <div>
    <h2>Maximum flood extent</h2>
    ${miniMap(ctx, layers)}
    <div class="legend">${DEPTH_BANDS.map((b) => `<span><i style="background:${b.color}"></i>${b.label}</span>`).join('')}<span><i style="background:#d03b3b"></i>dam axis</span></div>
  </div>
  <div>
    <h2>First places reached</h2>
    <table><thead><tr><th>Place</th><th class="n">km</th><th class="n">Arrives</th><th class="n">Depth</th><th class="n">Hazard</th><th class="n">People</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No settlement is reached in this run.</td></tr>'}</tbody></table>
    ${saved}
  </div>
</div>
<footer>
  <b>How these numbers were produced.</b> ${esc(ctx.eventSummary)}. Reservoir ${num(meta.volume / 1e6, 1)} million m³ at ${num(meta.waterDepth, 1)} m depth behind a ${num(meta.damHeight)} m dam; breach ${num(meta.breachWidth)} m wide and ${num(meta.breachDepth, 1)} m deep forming over ${clock(meta.formationTime)}; outflow routed level-pool through a broad-crested weir and drowned by the water level downstream.
  The flood is solved on a ${num(meta.cellSize)} m grid with Manning's n = ${meta.manning.toFixed(3)}. Hazard classes follow AIDR (2017) depth × velocity; damage uses the JRC global depth–damage curves for Asia; loss of life follows Graham (1999) fatality rates by severity and warning time; breach geometry follows Froehlich (2008) where it was not set by hand.
  <b>Data.</b> Terrain from SRTM/Terrarium tiles at ${num(meta.cellSize)} m; places, roads, bridges and facilities from OpenStreetMap contributors (ODbL), with populations estimated from place type where OSM gives none.
  <b>Limits.</b> Channels, embankments and culverts narrower than one cell are not resolved, and the terrain carries no river bathymetry, so depths and arrival times are indicative. Nothing here is a forecast or an official warning.
</footer>
</div></body></html>`;
}
