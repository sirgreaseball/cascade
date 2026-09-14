// Starting points for the scenario builder: Indian dams with approximate public figures
// (CWC National Register of Large Dams, India-WRIS, OpenStreetMap, operator websites).
// Locations are snapped to the river on the DEM when a scenario is built, and every value
// is editable. Verify against the dam owner's data before any operational use.

import { DAM_CRESTS } from './damCrests.ts';

export interface DamCatalogEntry {
  id: string;
  name: string;
  river: string;
  state: string;
  district?: string;
  nearestCity?: string;
  lng: number;
  lat: number;
  /** Height above the deepest foundation (m). */
  height: number;
  crestLength: number;
  /** Gross storage (million m³). */
  volumeMCM: number;
  type: 'Embankment' | 'Concrete gravity' | 'Arch' | 'Masonry' | 'Composite' | 'Rockfill' | string;
  year?: number;
}

export const DAM_CATALOG_ATTRIBUTION = {
  attributes: 'Central Water Commission (CWC) National Register of Large Dams (NRLD), Government Open Data License - India (GODL)',
  coordinates: '© OpenStreetMap contributors (ODbL) and Wikidata (CC0)',
};

/** Bundled core dams, instantly available without network requests. */
export const DAM_CATALOG: DamCatalogEntry[] = [
  { id: 'tehri', name: 'Tehri', river: 'Bhagirathi', state: 'Uttarakhand', district: 'Tehri Garhwal', nearestCity: 'New Tehri', lng: 78.4806, lat: 30.3778, height: 260.5, crestLength: 575, volumeMCM: 3540, type: 'Embankment', year: 2006 },
  { id: 'bhakra', name: 'Bhakra', river: 'Sutlej', state: 'Himachal Pradesh', district: 'Bilaspur', nearestCity: 'Nangal', lng: 76.4333, lat: 31.4108, height: 226, crestLength: 518, volumeMCM: 9340, type: 'Concrete gravity', year: 1963 },
  { id: 'pong', name: 'Pong (Beas)', river: 'Beas', state: 'Himachal Pradesh', district: 'Kangra', nearestCity: 'Talwara', lng: 75.95, lat: 31.967, height: 133, crestLength: 1951, volumeMCM: 8570, type: 'Embankment', year: 1974 },
  { id: 'ranjit-sagar', name: 'Ranjit Sagar', river: 'Ravi', state: 'Punjab', district: 'Pathankot', nearestCity: 'Pathankot', lng: 75.73, lat: 32.44, height: 160, crestLength: 617, volumeMCM: 3280, type: 'Embankment', year: 2001 },
  { id: 'sardar-sarovar', name: 'Sardar Sarovar', river: 'Narmada', state: 'Gujarat', district: 'Narmada', nearestCity: 'Kevadia (Ekta Nagar)', lng: 73.747, lat: 21.83, height: 163, crestLength: 1210, volumeMCM: 9500, type: 'Concrete gravity', year: 2017 },
  { id: 'indira-sagar', name: 'Indira Sagar', river: 'Narmada', state: 'Madhya Pradesh', district: 'Khandwa', nearestCity: 'Punasa', lng: 76.47, lat: 22.283, height: 92, crestLength: 653, volumeMCM: 12220, type: 'Concrete gravity', year: 2005 },
  { id: 'hirakud', name: 'Hirakud', river: 'Mahanadi', state: 'Odisha', district: 'Sambalpur', nearestCity: 'Sambalpur', lng: 83.872, lat: 21.572, height: 61, crestLength: 4800, volumeMCM: 8136, type: 'Embankment', year: 1957 },
  { id: 'rihand', name: 'Rihand', river: 'Rihand', state: 'Uttar Pradesh', district: 'Sonbhadra', nearestCity: 'Renukoot', lng: 83.01, lat: 24.2, height: 91, crestLength: 934, volumeMCM: 10600, type: 'Concrete gravity', year: 1962 },
  { id: 'ukai', name: 'Ukai', river: 'Tapi', state: 'Gujarat', district: 'Tapi', nearestCity: 'Songadh', lng: 73.59, lat: 21.25, height: 81, crestLength: 4927, volumeMCM: 8510, type: 'Embankment', year: 1972 },
  { id: 'koyna', name: 'Koyna', river: 'Koyna', state: 'Maharashtra', district: 'Satara', nearestCity: 'Koynanagar', lng: 73.752, lat: 17.402, height: 103, crestLength: 807, volumeMCM: 2797, type: 'Concrete gravity', year: 1964 },
  { id: 'nagarjuna-sagar', name: 'Nagarjuna Sagar', river: 'Krishna', state: 'Telangana · Andhra Pradesh', district: 'Nalgonda / Palnadu', nearestCity: 'Macherla', lng: 79.312, lat: 16.575, height: 124, crestLength: 1550, volumeMCM: 11560, type: 'Masonry', year: 1967 },
  { id: 'srisailam', name: 'Srisailam', river: 'Krishna', state: 'Andhra Pradesh', district: 'Nandyal', nearestCity: 'Srisailam', lng: 78.897, lat: 16.087, height: 145, crestLength: 512, volumeMCM: 6110, type: 'Concrete gravity', year: 1981 },
  { id: 'tungabhadra', name: 'Tungabhadra', river: 'Tungabhadra', state: 'Karnataka', district: 'Vijayanagara', nearestCity: 'Hosapete', lng: 76.339, lat: 15.268, height: 50, crestLength: 2449, volumeMCM: 3760, type: 'Masonry', year: 1953 },
  { id: 'mettur', name: 'Mettur', river: 'Kaveri', state: 'Tamil Nadu', district: 'Salem', nearestCity: 'Mettur', lng: 77.801, lat: 11.786, height: 65, crestLength: 1700, volumeMCM: 2650, type: 'Masonry', year: 1934 },
  { id: 'idukki', name: 'Idukki', river: 'Periyar', state: 'Kerala', district: 'Idukki', nearestCity: 'Thodupuzha', lng: 76.976, lat: 9.843, height: 169, crestLength: 366, volumeMCM: 1996, type: 'Arch', year: 1975 },
  { id: 'mullaperiyar', name: 'Mullaperiyar', river: 'Periyar', state: 'Kerala', district: 'Idukki', nearestCity: 'Kumily', lng: 77.144, lat: 9.529, height: 54, crestLength: 366, volumeMCM: 443, type: 'Masonry', year: 1895 },
];

let nationalCatalogCache: DamCatalogEntry[] | null = null;
let nationalCatalogPromise: Promise<DamCatalogEntry[]> | null = null;

/**
 * Lazy-loads the full national catalogue of Indian dams only when requested (e.g. when search opens).
 * Returns cached results on subsequent calls.
 */
export async function loadNationalDamCatalog(): Promise<DamCatalogEntry[]> {
  if (nationalCatalogCache) return nationalCatalogCache;
  if (nationalCatalogPromise) return nationalCatalogPromise;
  nationalCatalogPromise = (async () => {
    try {
      const res = await fetch('/data/dams-national.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: DamCatalogEntry[] = Array.isArray(data) ? data : data.dams ?? [];
      nationalCatalogCache = list.length > 0 ? list : DAM_CATALOG;
      return nationalCatalogCache;
    } catch {
      return DAM_CATALOG;
    }
  })();
  return nationalCatalogPromise;
}

/** Finds a dam entry in either the loaded national catalogue or the bundled list. */
export function findCatalogDam(id: string): DamCatalogEntry | undefined {
  if (nationalCatalogCache) {
    const found = nationalCatalogCache.find((d) => d.id === id);
    if (found) return found;
  }
  return DAM_CATALOG.find((d) => d.id === id);
}

/**
 * The stored crest line (from OpenStreetMap) of the catalogue dam within 5 km of a site, if
 * any: lets scenarios on known dams place the dam exactly, with no network lookup or guessing.
 */
export function catalogCrestLine(lng: number, lat: number): [number, number][] | null {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  let best: [number, number][] | null = null;
  let bestDistance = 5000;
  const list = nationalCatalogCache ?? DAM_CATALOG;
  for (const dam of list) {
    const line = DAM_CRESTS[dam.id];
    if (!line) continue;
    const d = Math.hypot((dam.lng - lng) * kx, (dam.lat - lat) * 110_574);
    if (d < bestDistance) {
      bestDistance = d;
      best = line;
    }
  }
  return best;
}

export interface DamGroup {
  key: string;
  title: string;
  subtitle?: string;
  dams: DamCatalogEntry[];
}

export const STATE_ALIASES: Record<string, string[]> = {
  'andhra pradesh': ['ap', 'andhra'],
  'arunachal pradesh': ['arunachal', 'ar'],
  'assam': ['as'],
  'bihar': ['br'],
  'chhattisgarh': ['cg', 'chhatisgarh'],
  'goa': ['ga'],
  'gujarat': ['gj', 'gujrat'],
  'haryana': ['hr'],
  'himachal pradesh': ['hp', 'himachal'],
  'jharkhand': ['jh'],
  'karnataka': ['ka'],
  'kerala': ['kl'],
  'madhya pradesh': ['mp'],
  'maharashtra': ['mh', 'maha', 'maharastra'],
  'manipur': ['mn'],
  'meghalaya': ['ml'],
  'mizoram': ['mz'],
  'nagaland': ['nl'],
  'odisha': ['orissa', 'od'],
  'punjab': ['pb'],
  'rajasthan': ['rj', 'raj'],
  'sikkim': ['sk'],
  'tamil nadu': ['tn', 'tamilnadu', 'madras'],
  'telangana': ['ts', 'tg'],
  'tripura': ['tr'],
  'uttar pradesh': ['up'],
  'uttarakhand': ['uk', 'uttaranchal', 'ua'],
  'west bengal': ['wb', 'bengal'],
  'jammu and kashmir': ['j&k', 'jk', 'kashmir', 'jammu'],
  'ladakh': ['la'],
};

export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isFuzzyWordMatch(queryToken: string, targetWord: string): boolean {
  if (targetWord.startsWith(queryToken) || queryToken.startsWith(targetWord)) return true;
  if (queryToken.length < 4 || targetWord.length < 4) return false;
  if (Math.abs(queryToken.length - targetWord.length) > 1) return false;
  let diffs = 0;
  let i = 0;
  let j = 0;
  while (i < queryToken.length && j < targetWord.length) {
    if (queryToken[i] === targetWord[j]) {
      i++;
      j++;
    } else {
      diffs++;
      if (diffs > 1) return false;
      if (queryToken.length > targetWord.length) {
        i++;
      } else if (queryToken.length < targetWord.length) {
        j++;
      } else {
        i++;
        j++;
      }
    }
  }
  return true;
}

export function tokenMatchesField(token: string, fieldValue: string | undefined): boolean {
  if (!fieldValue) return false;
  const norm = normalizeSearchText(fieldValue);
  const words = norm.split(' ');
  if (token.length <= 2) {
    return words.includes(token);
  }
  if (norm.includes(token)) return true;
  for (const w of words) {
    if (isFuzzyWordMatch(token, w)) return true;
  }
  return false;
}

export function tokenMatchesState(token: string, stateName: string): boolean {
  if (tokenMatchesField(token, stateName)) return true;
  const normState = normalizeSearchText(stateName);
  for (const [canonical, aliases] of Object.entries(STATE_ALIASES)) {
    if (normState.includes(canonical)) {
      if (aliases.includes(token)) return true;
      for (const a of aliases) {
        if (isFuzzyWordMatch(token, a)) return true;
      }
    }
  }
  return false;
}

export function damMatchesTokens(tokens: string[], dam: DamCatalogEntry): { matches: boolean; matchesState: boolean; matchesDistrictOrCity: boolean } {
  let matchesState = false;
  let matchesDistrictOrCity = false;

  for (const t of tokens) {
    const stateHit = tokenMatchesState(t, dam.state);
    const distHit = tokenMatchesField(t, dam.district);
    const cityHit = tokenMatchesField(t, dam.nearestCity);
    const nameHit = tokenMatchesField(t, dam.name);
    const riverHit = tokenMatchesField(t, dam.river);
    const typeHit = tokenMatchesField(t, dam.type);

    if (stateHit) matchesState = true;
    if (distHit || cityHit) matchesDistrictOrCity = true;

    if (!stateHit && !distHit && !cityHit && !nameHit && !riverHit && !typeHit) {
      return { matches: false, matchesState: false, matchesDistrictOrCity: false };
    }
  }
  return { matches: true, matchesState, matchesDistrictOrCity };
}

/**
 * Searches the national dam catalog using multi-token matching, tolerant spelling, state aliases,
 * and groups the results according to the query context (by district when searching a state, by
 * city/district when searching local regions, or by state for broad searches).
 */
export function searchDamCatalog(
  query: string,
  catalog: DamCatalogEntry[],
  excludeIds?: Set<string>
): DamGroup[] {
  const normQuery = normalizeSearchText(query);
  if (!normQuery) return [];
  const tokens = normQuery.split(' ').filter(Boolean);
  if (tokens.length === 0) return [];

  const matchedDams: { dam: DamCatalogEntry; matchesState: boolean; matchesDistrictOrCity: boolean }[] = [];
  let anyMatchesState = false;
  let anyMatchesDistrictOrCity = false;

  for (const dam of catalog) {
    if (excludeIds && excludeIds.has(dam.id)) continue;
    const res = damMatchesTokens(tokens, dam);
    if (res.matches) {
      matchedDams.push({ dam, matchesState: res.matchesState, matchesDistrictOrCity: res.matchesDistrictOrCity });
      if (res.matchesState) anyMatchesState = true;
      if (res.matchesDistrictOrCity) anyMatchesDistrictOrCity = true;
    }
  }

  if (matchedDams.length === 0) return [];

  const groupsMap = new Map<string, { title: string; subtitle?: string; dams: DamCatalogEntry[] }>();

  for (const { dam, matchesState, matchesDistrictOrCity } of matchedDams) {
    let groupKey: string;
    let title: string;
    let subtitle: string | undefined;

    if (anyMatchesState || matchesState) {
      // Group by District when searching a state
      const district = dam.district || 'Other Districts';
      groupKey = `${dam.state}::${district}`;
      title = district;
      subtitle = dam.state;
    } else if (anyMatchesDistrictOrCity || matchesDistrictOrCity) {
      // Group by District / City when searching a district or city
      const district = dam.district || dam.nearestCity || 'District';
      groupKey = `${dam.state}::${district}`;
      title = `${district}, ${dam.state}`;
      subtitle = dam.nearestCity && dam.nearestCity !== district ? `Near ${dam.nearestCity}` : undefined;
    } else {
      // General match: group by state
      groupKey = dam.state;
      title = dam.state;
      subtitle = undefined;
    }

    const existing = groupsMap.get(groupKey);
    if (existing) {
      existing.dams.push(dam);
    } else {
      groupsMap.set(groupKey, { title, subtitle, dams: [dam] });
    }
  }

  const groups: DamGroup[] = [];
  for (const [key, val] of groupsMap.entries()) {
    val.dams.sort((a, b) => a.name.localeCompare(b.name));
    groups.push({
      key,
      title: val.title,
      subtitle: val.subtitle,
      dams: val.dams,
    });
  }

  groups.sort((a, b) => a.title.localeCompare(b.title));
  return groups;
}

