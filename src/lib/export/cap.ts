// Common Alerting Protocol (CAP 1.2, OASIS) export: the alert format of India's SACHET
// integrated alert system and of most national warning systems. One <info> block in English
// and one in Hindi, each with one <area> per flooded settlement in order of flood arrival.
// Marked as an exercise: it comes from a simulated scenario, and an issuing authority must
// replace the sender and review the text before any real use.

import type { ExportContext } from './index';
import { formatNumber } from '@/lib/format';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** ISO 8601 in Indian Standard Time, as CAP expects (no fractional seconds). */
function ist(ms: number): string {
  return `${new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 19)}+05:30`;
}

function span(seconds: number, lang: 'en' | 'hi'): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (lang === 'hi') return h > 0 ? `${h} घंटे ${m} मिनट` : `${m} मिनट`;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** Radius (km) of the alert circle drawn around a settlement of each kind. */
const RADIUS_KM: Record<string, number> = { city: 4, town: 2, suburb: 1.5, village: 0.8, hamlet: 0.4 };

const EVENT_HI: Record<string, string> = {
  'Dam break': 'बांध टूटने से बाढ़',
  'Lake outburst': 'झील फटने से बाढ़',
  'Controlled release': 'जलाशय से पानी छोड़े जाने से बाढ़',
};

export function exportCap(ctx: ExportContext, now = Date.now()): string {
  const places = ctx.statuses
    .map((s, i) => ({ s, a: ctx.exposure.assets[i] }))
    .filter(({ s, a }) => a.kind === 'settlement' && s.arrival >= 0 && s.maxDepth >= 0.1)
    .sort((x, y) => x.s.arrival - y.s.arrival)
    .slice(0, 60);
  const kind = ctx.eventSummary.split(/[,;]/)[0].trim() || 'Dam break';
  const dam = ctx.dam.name;
  const people = formatNumber(ctx.impact.peopleExposed);
  // All flooded settlements, not just the (at most 60) that get an <area>.
  const settlements = formatNumber(ctx.impact.settlementsFlooded);
  const first = places[0];

  const text = {
    en: {
      event: `${kind} flood`,
      headline: `${kind} flood from ${dam}: move to high ground now`,
      description:
        `Simulated scenario (exercise), not an official warning. ${ctx.eventSummary}. The model (${ctx.engineLabel}) floods ${settlements} settlements ` +
        `with about ${people} people` +
        (first ? `; the water first reaches ${first.a.name} ${span(first.s.arrival, 'en')} after the breach.` : '.'),
      instruction: 'Leave low ground near the river now and move to high ground. Do not cross bridges, causeways or flooded roads. Follow instructions from the district administration.',
      sender: `Cascade simulation: ${ctx.scenarioName}`,
      area: (name: string, arrival: number, depth: string) => `${name}: flood expected ${span(arrival, 'en')} after the breach, up to ${depth} m deep`,
    },
    hi: {
      event: EVENT_HI[kind] ?? 'बाढ़',
      headline: `${dam} से ${EVENT_HI[kind] ?? 'बाढ़'}: तुरंत ऊँचे स्थान पर जाएँ`,
      description:
        `यह एक अभ्यास (सिमुलेशन) परिदृश्य है, आधिकारिक चेतावनी नहीं। मॉडल के अनुसार ${settlements} बस्तियाँ और लगभग ${people} लोग प्रभावित हो सकते हैं` +
        (first ? `; पानी सबसे पहले ${first.a.name} में बांध टूटने के ${span(first.s.arrival, 'hi')} बाद पहुँचेगा।` : '।'),
      instruction: 'नदी के पास के निचले इलाकों को तुरंत छोड़ें और ऊँचे स्थान पर जाएँ। पुल, रपटे या पानी से भरी सड़कें पार न करें। ज़िला प्रशासन के निर्देशों का पालन करें।',
      sender: `Cascade सिमुलेशन: ${ctx.scenarioName}`,
      area: (name: string, arrival: number, depth: string) => `${name}: बांध टूटने के ${span(arrival, 'hi')} बाद बाढ़ की आशंका, ${depth} मीटर तक गहरा पानी`,
    },
  };

  const info = (lang: 'en' | 'hi') => {
    const t = text[lang];
    const areas = places
      .map(({ s, a }) => {
        const depth = formatNumber(s.maxDepth, s.maxDepth < 10 ? 1 : 0);
        return [
          '    <area>',
          `      <areaDesc>${esc(t.area(a.name, s.arrival, depth))}</areaDesc>`,
          `      <circle>${a.lat.toFixed(5)},${a.lng.toFixed(5)} ${RADIUS_KM[a.subtype] ?? 0.8}</circle>`,
          '    </area>',
        ].join('\n');
      })
      .join('\n');
    return [
      '  <info>',
      `    <language>${lang === 'en' ? 'en-IN' : 'hi-IN'}</language>`,
      '    <category>Met</category>',
      '    <category>Infra</category>',
      `    <event>${esc(t.event)}</event>`,
      '    <responseType>Evacuate</responseType>',
      '    <urgency>Immediate</urgency>',
      '    <severity>Extreme</severity>',
      '    <certainty>Possible</certainty>',
      `    <expires>${ist(now + 12 * 3600_000)}</expires>`,
      `    <senderName>${esc(t.sender)}</senderName>`,
      `    <headline>${esc(t.headline)}</headline>`,
      `    <description>${esc(t.description)}</description>`,
      `    <instruction>${esc(t.instruction)}</instruction>`,
      areas,
      '  </info>',
    ]
      .filter(Boolean)
      .join('\n');
  };

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">',
    `  <identifier>cascade-${esc(ctx.scenarioId)}-${now}</identifier>`,
    '  <sender>cascade-simulation</sender>',
    `  <sent>${ist(now)}</sent>`,
    '  <status>Exercise</status>',
    '  <msgType>Alert</msgType>',
    '  <scope>Public</scope>',
    '  <note>Exercise generated by Cascade from a simulated scenario. The issuing authority must replace the sender and review the text before any real use.</note>',
    info('en'),
    info('hi'),
    '</alert>',
    '',
  ].join('\n');
}
