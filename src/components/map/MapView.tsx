'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import type { DeckGLRef } from '@deck.gl/react';
import type { Device } from '@luma.gl/core';
import MapGL from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { AmbientLight, COORDINATE_SYSTEM, DirectionalLight, FlyToInterpolator, LightingEffect } from '@deck.gl/core';
import type { Layer, MapViewState, PickingInfo } from '@deck.gl/core';
import { BitmapLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { TerrainLayer } from '@deck.gl/geo-layers';
import { HiResTerrainLayer } from './hiResTerrain';
import { HazeExtension } from './haze';
// Main-thread terrain parser: deck.gl bundles only the worker loader, whose script would be
// fetched from a CDN at runtime (and fail offline).
import { TerrainLoader } from '@loaders.gl/terrain';
import { useEnsembleStore } from '@/store/ensembleStore';
import { useScenarioStore } from '@/store/scenarioStore';
import { isRunning, useSimStore } from '@/store/simulationStore';
import { useUiStore } from '@/store/uiStore';
import { results } from '@/simulation/results';
import type { SimulationSetup } from '@/simulation/setup';
import type { ScenarioConfig } from '@/lib/scenario';
import { lngLatToCell, sampleBilinear } from '@/lib/geo/grid';
import { TERRARIUM_URL } from '@/lib/geo/terrarium';
import { hazardClass } from '@/lib/damage';
import { planEvacuation } from '@/lib/evacuation';
import type { EvacuationRoute } from '@/lib/evacuation';
import { formatClock, formatDepth, formatSpeed, formatNumber } from '@/lib/format';
import { displayName } from '@/lib/text';
import { detectGpu } from '@/lib/gpu';
import { setMapGpu, classifyGpu, getMapGpu, onPerfChange } from '@/lib/perfMonitor';
import type { GpuKind } from '@/lib/perfMonitor';
import { primaryEngine, useFrameIndex, usePrimaryEngine, useImpacts } from '@/components/useSimView';
import {
  HAZARD_COLORS,
  hexToRgb,
  IDENTITY,
  paintArrival,
  paintDifference,
  paintDifferenceMetres,
  paintHazard,
  paintMaxDepth,
  paintProbability,
  paintVelocity,
} from './colormaps';
import { FloodExtension, FloodField, keyOf } from './floodGpu';
import type { FloodFrame } from './floodGpu';
import { hillshadeDataUrl, IMAGERY_ATTRIBUTION, IMAGERY_URL, MAP_ATTRIBUTION, MAP_LABELS_URL, MAP_TILES_URL, ROADS_ATTRIBUTION, ROADS_OVERLAY_URL, satelliteDataUrl, terrariumDataUrl } from './terrain';

/** Sky and horizon glow above the 3D terrain; the horizon matches the terrain's haze. */
const SKY_SATELLITE = { 'sky-color': '#3b6186', 'horizon-color': '#aebfd0', 'fog-color': '#aebfd0', 'sky-horizon-blend': 0.55, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.85 };
const SKY_MAP = { 'sky-color': '#07080a', 'horizon-color': '#1d2127', 'fog-color': '#1d2127', 'sky-horizon-blend': 0.55, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.85 };

const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    imagery: { type: 'raster' as const, tiles: [IMAGERY_URL], tileSize: 256, maxzoom: 19, attribution: IMAGERY_ATTRIBUTION },
    roads: { type: 'raster' as const, tiles: [ROADS_OVERLAY_URL], tileSize: 256, maxzoom: 19, attribution: ROADS_ATTRIBUTION },
  },
  layers: [
    { id: 'background', type: 'background' as const, paint: { 'background-color': '#0b0b0c' } },
    { id: 'imagery', type: 'raster' as const, source: 'imagery', paint: { 'raster-saturation': -0.22, 'raster-contrast': 0.04, 'raster-brightness-max': 0.96 } },
    { id: 'roads', type: 'raster' as const, source: 'roads', paint: { 'raster-opacity': 0.75 } },
  ],
};
const LIGHT_STYLE = {
  version: 8 as const,
  sources: {
    base: { type: 'raster' as const, tiles: [MAP_TILES_URL], tileSize: 256, maxzoom: 16, attribution: MAP_ATTRIBUTION },
    labels: { type: 'raster' as const, tiles: [MAP_LABELS_URL], tileSize: 256, maxzoom: 16 },
  },
  layers: [
    { id: 'background', type: 'background' as const, paint: { 'background-color': '#0b0b0c' } },
    { id: 'base', type: 'raster' as const, source: 'base' },
    { id: 'labels', type: 'raster' as const, source: 'labels' },
  ],
};
/**
 * Under 3D terrain the flat basemap only shows where terrain tiles are still loading or beyond
 * the terrain's reach, so 512-px tiles (a quarter as many) and no labels keep it cheap.
 */
/** No fade-in under 3D terrain: each fading tile repainted the map for 300 ms. */
const noFade = <T extends { type: string; paint?: object }>(layers: T[]) =>
  layers.map((l) => (l.type === 'raster' ? { ...l, paint: { ...l.paint, 'raster-fade-duration': 0 } } : l));
const SATELLITE_STYLE_3D = {
  ...SATELLITE_STYLE,
  sources: { imagery: { ...SATELLITE_STYLE.sources.imagery, tileSize: 512 } },
  layers: [
    { id: 'background', type: 'background' as const, paint: { 'background-color': '#1c241c' } },
    ...noFade(SATELLITE_STYLE.layers.filter((l) => l.id !== 'background')),
  ],
  sky: SKY_SATELLITE,
};
const LIGHT_STYLE_3D = {
  ...LIGHT_STYLE,
  sources: { base: { ...LIGHT_STYLE.sources.base, tileSize: 512 } },
  layers: [
    { id: 'background', type: 'background' as const, paint: { 'background-color': '#121519' } },
    ...noFade(LIGHT_STYLE.layers.filter((l) => l.id !== 'background' && l.id !== 'labels')),
  ],
  sky: SKY_MAP,
};
/** Copied from node_modules by scripts/copy-workers.mjs: terrain meshing off the main thread. */
const TERRAIN_WORKER_URL = '/workers/terrain-worker.js';
/** Rendering resolution cap: full sharpness on normal screens, 1.5× on high-DPI ones. */
const PIXEL_RATIO = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;

const TERRARIUM_DECODER = { rScaler: 256, gScaler: 1, bScaler: 1 / 256, offset: -32768 };
/** Matte ground: the imagery carries its own sun and shadow; smooth normals add gentle relief. */
// Rock and vegetation are matte: no specular at all, and with a real sun configured the shape
// comes from the light rather than from the imagery, so diffuse carries most of the response.
const TERRAIN_MATERIAL = { ambient: 0.42, diffuse: 0.92, shininess: 1, specularColor: [0, 0, 0] as [number, number, number] };
const HAZE_SATELLITE: [number, number, number] = [0.682, 0.749, 0.816];
const HAZE_MAP: [number, number, number] = [0.114, 0.129, 0.153];
/** The water shader adds its own sun glints; the material keeps only a soft sheen. */
const WATER_MATERIAL = { ambient: 0.8, diffuse: 0.35, shininess: 48, specularColor: [25, 25, 25] as [number, number, number] };
/** Metres the water skin and roads float above the scenario DEM, to stay clear of the terrain mesh. */
const SKIN_LIFT = 8;
const GPU = detectGpu();

/**
 * Only the places layer takes part in picking. Letting the terrain and the layers draped on it
 * into the picking pass makes deck.gl decode colours that belong to no pickable layer
 * ("Picked non-existent layer"); hover readouts over the flood are computed from the rasters.
 */
const pickOnlyPlaces = ({ layer, renderPass }: { layer: Layer; renderPass: string }) => !renderPass.includes('pick') || layer.id === 'assets';

/** The flood's textures, shared by the 2D and 3D flood layers; rebuilt when the grid changes. */
let floodField: FloodField | null = null;
let terrainTileErrors = 0;
/** The 2D flood layer needs an image of its own, but its colour comes from the flood shader. */
const BLANK_IMAGE = typeof ImageData !== 'undefined' ? new ImageData(1, 1) : null;
const OBSERVED_RGB = hexToRgb(IDENTITY.observed);

/**
 * The flood at the playhead, read from the stores on every draw so it animates at the display's own
 * rate without re-rendering React. Textures are re-uploaded only when a new pair of frames, a new
 * envelope or a different painted layer is actually needed.
 */
function floodFrame(device: Device): FloodFrame {
  const { data, observed, external } = useScenarioStore.getState();
  const ensemble = useEnsembleStore.getState().result;
  const sim = useSimStore.getState();
  const cols = data?.grid.cols ?? 1;
  const rows = data?.grid.rows ?? 1;
  if (!floodField || floodField.device !== device || floodField.cols !== cols || floodField.rows !== rows) {
    floodField?.destroy();
    floodField = new FloodField(device, cols, rows);
  }
  const field = floodField;
  const t = sim.playhead;
  const engine = primaryEngine(sim.view.engine, sim.engines, { swe: sim.runs.swe.frames, sph: sim.runs.sph.frames });
  const r = results.get(engine);
  const layer = sim.view.layer;
  const mask = observed && sim.view.showObserved ? observed.mask : null;
  // The observed (satellite) extent shows wherever the model is dry.
  const underMask = (out: Uint8ClampedArray) => {
    if (!mask) return;
    for (let k = 0; k < mask.length; k++) {
      const o = k * 4;
      if (mask[k] && out[o + 3] === 0) {
        out[o] = OBSERVED_RGB[0];
        out[o + 1] = OBSERVED_RGB[1];
        out[o + 2] = OBSERVED_RGB[2];
        out[o + 3] = 125;
      }
    }
  };
  const still = (key: string, paint: (out: Uint8ClampedArray) => void): FloodFrame => {
    field.setImage(key, (out) => {
      out.fill(0);
      paint(out);
      underMask(out);
    });
    return { field, mode: 'static', mix: 0, time: t, hasArrival: false, hasImage: true };
  };

  if (layer === 'depth') {
    field.setImage(`mask:${keyOf(mask)}`, (out) => {
      out.fill(0);
      underMask(out);
    });
    const loc = results.locate(engine, t);
    if (!r || !loc) {
      field.setFrames(null, null);
      return { field, mode: 'frames', mix: 0, time: t, hasArrival: false, hasImage: !!mask };
    }
    const later = loc.i1 !== loc.i0 ? r.depth[loc.i1] : null;
    field.setFrames(r.depth[loc.i0], later);
    field.setArrival(r.summary?.arrival ?? null);
    return { field, mode: 'frames', mix: later ? loc.f : 0, time: t, hasArrival: !!r.summary, hasImage: !!mask };
  }
  if (layer === 'difference') {
    const a = results.get('swe');
    const b = results.get('sph');
    const la = results.locate('swe', t);
    const lb = results.locate('sph', t);
    if (a && b && la && lb) return still(`diff:${keyOf(a.depth[la.i0])}:${keyOf(b.depth[lb.i0])}:${keyOf(mask)}`, (out) => paintDifference(out, a.depth[la.i0], b.depth[lb.i0]));
    const s = a?.summary;
    if (external && s) return still(`ext:${keyOf(s.maxDepth)}:${keyOf(external.maxDepth)}:${keyOf(mask)}`, (out) => paintDifferenceMetres(out, s.maxDepth, external.maxDepth));
    return still(`none:${keyOf(mask)}`, () => undefined);
  }
  if (layer === 'probability') {
    return still(`chance:${keyOf(ensemble?.probability)}:${keyOf(mask)}`, (out) => {
      if (ensemble) paintProbability(out, ensemble.probability);
    });
  }
  // Envelopes are painted in full once per summary; the shader reveals each cell as the water arrives.
  const s = r?.summary ?? null;
  field.setImage(`${layer}:${keyOf(s)}:${keyOf(mask)}`, (out) => {
    out.fill(0);
    if (s) {
      if (layer === 'maxDepth') paintMaxDepth(out, s.maxDepth, s.arrival, Infinity);
      else if (layer === 'arrival') paintArrival(out, s.arrival, Infinity);
      else if (layer === 'hazard') paintHazard(out, s.maxDepth, s.maxSpeed, s.maxDepthVelocity, s.arrival, Infinity);
      else if (layer === 'velocity') paintVelocity(out, s.maxSpeed, s.arrival, Infinity);
    }
    underMask(out);
  });
  field.setArrival(s?.arrival ?? null);
  return { field, mode: 'revealed', mix: 0, time: t, hasArrival: !!s, hasImage: true };
}

const FLOOD = new FloodExtension({ frame: floodFrame });
const FLOOD_TERRAIN = new FloodExtension({
  frame: floodFrame,
  inTerrain: true,
  bbox: () => useScenarioStore.getState().data?.grid.bbox,
  sky: () => (useSimStore.getState().view.basemap === 'satellite' ? [0.68, 0.75, 0.82] : [0.11, 0.13, 0.15]),
});

function reservoirLevelAt(setup: SimulationSetup, config: ScenarioConfig, t: number): number {
  const bedElev = setup.site.bed.elevation;
  const initialDepth = config.dam.waterDepth ?? config.dam.height * 0.95;
  const breach = setup.configs.swe?.breach ?? setup.configs.sph?.breach;
  if (!breach) return bedElev + initialDepth;

  const p = breach.event;
  const hb = Math.min(Math.max(p.breachDepth, 1), p.damHeight);
  const invertAboveBase = p.damHeight - hb;
  const headAtStart = Math.max(p.waterDepth - invertAboveBase, 0);
  const m = Math.max(p.storageExponent ?? 1.5, 1);
  const releasableVolume = p.volume * (p.waterDepth > 0 ? (headAtStart / p.waterDepth) ** m : 0);

  let released = 0;
  const { t: ht, q: hq } = setup.hydrograph;
  for (let i = 0; i < ht.length - 1 && ht[i] < t; i++) {
    const t0 = ht[i];
    const t1 = Math.min(ht[i + 1], t);
    const dt = t1 - t0;
    if (dt <= 0) break;
    const frac = (t1 - t0) / Math.max(ht[i + 1] - t0, 1e-4);
    const q1 = hq[i] + (hq[i + 1] - hq[i]) * frac;
    released += 0.5 * (hq[i] + q1) * dt;
  }
  const remaining = Math.max(0, releasableVolume - released);
  const currentHead = remaining > 0 && releasableVolume > 0 ? headAtStart * (remaining / releasableVolume) ** (1 / m) : 0;
  return bedElev + invertAboveBase + currentHead;
}

function computeReservoirPolygon(
  setup: SimulationSetup,
  config: ScenarioConfig,
  bbox: [number, number, number, number],
  playhead: number,
): [number, number, number][] | null {
  const site = setup.site;
  const crest = site.crestLine && site.crestLine.length >= 2 ? site.crestLine : site.axis;
  if (!crest || crest.length < 2) return null;

  const poolElev = reservoirLevelAt(setup, config, playhead);

  // Upstream direction: opposite to site.direction
  // In grid coords: x is east (+lng), y is south (-lat).
  // site.direction = [dx, dy] is downstream.
  // Upstream vector in (lng, lat): [-dx, dy]
  const U = [-site.direction[0], site.direction[1]];
  const uLen = Math.hypot(U[0], U[1]) || 1;
  const u = [U[0] / uLen, U[1] / uLen];
  const v = [-u[1], u[0]];

  const [w, s, e, n] = bbox;
  const span = Math.hypot(e - w, n - s);
  const reach = span * 1.5;

  const p0 = crest[0];
  const pn = crest[crest.length - 1];

  const poly: [number, number, number][] = crest.map(([lng, lat]) => [lng, lat, poolElev]);

  const corner1: [number, number, number] = [pn[0] + (u[0] + v[0] * 1.2) * reach, pn[1] + (u[1] + v[1] * 1.2) * reach, poolElev];
  const upHead: [number, number, number] = [0.5 * (p0[0] + pn[0]) + u[0] * reach * 1.4, 0.5 * (p0[1] + pn[1]) + u[1] * reach * 1.4, poolElev];
  const corner2: [number, number, number] = [p0[0] + (u[0] - v[0] * 1.2) * reach, p0[1] + (u[1] - v[1] * 1.2) * reach, poolElev];

  poly.push(corner1, upHead, corner2, [crest[0][0], crest[0][1], poolElev]);
  return poly;
}

interface Hover {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

/**
 * Offline 3D terrain: the scenario DEM as a single mesh, textured with a satellite snapshot
 * when it can be fetched, otherwise a local hillshade. Only built when world terrain is off.
 */
function useLocalTerrain(enabled: boolean) {
  const config = useScenarioStore((s) => s.config);
  const data = useScenarioStore((s) => s.data);
  const [satTex, setSatTex] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!enabled || !config || !data) return;
    let cancelled = false;
    if (typeof navigator === 'undefined' || navigator.onLine) {
      satelliteDataUrl(data.grid.bbox).then((sat) => {
        if (!cancelled && sat) setSatTex({ id: config.id, url: sat });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [enabled, config, data]);

  return useMemo(() => {
    if (!enabled || !config || !data) return null;
    const elevation = terrariumDataUrl(data.dem, data.grid.cols, data.grid.rows);
    const texture = satTex && satTex.id === config.id ? satTex.url : hillshadeDataUrl(data.dem, data.grid);
    return { id: config.id, elevation, texture };
  }, [enabled, config, data, satTex]);
}

const metresPerPixel = (zoom: number, lat: number) => (156_543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;

export default function MapView() {
  const config = useScenarioStore((s) => s.config);
  const data = useScenarioStore((s) => s.data);
  const exposure = useScenarioStore((s) => s.exposure);
  const observed = useScenarioStore((s) => s.observed);
  const ensemble = useEnsembleStore((s) => s.result);
  const setup = useSimStore((s) => s.setup);
  const view = useSimStore((s) => s.view);
  const engines = useSimStore((s) => s.engines);
  // The flood reads the playhead itself on every draw (floodFrame): React re-renders when results
  // arrive or playback starts and stops, never once per frame.
  const hasResults = useSimStore((s) => s.runs.swe.frames > 0 || s.runs.sph.frames > 0);
  const animating = useSimStore((s) => s.playing || (s.follow && isRunning(s.runs)));
  const sphFrame = useFrameIndex('sph');
  const deckRef = useRef<DeckGLRef>(null);
  const selectedAsset = useSimStore((s) => s.selectedAsset);
  const pickingDam = useUiStore((s) => s.pickingDam);
  const primary = usePrimaryEngine();
  const impacts = useImpacts(primary);
  // Seamless world terrain from the same SRTM tiles when online; the scenario DEM block offline.
  const [terrainMode, setTerrainMode] = useState<'world' | 'local'>(() => (typeof navigator !== 'undefined' && !navigator.onLine ? 'local' : 'world'));
  const [gpuKind, setGpuKind] = useState<GpuKind>(() => {
    const g = getMapGpu();
    return g ? classifyGpu(g.renderer) : 'unknown';
  });
  useEffect(() => {
    return onPerfChange(() => {
      const g = getMapGpu();
      if (g) setGpuKind(classifyGpu(g.renderer));
    });
  }, []);
  // Mesh terrain in a worker; if the worker cannot start, fall back to the main thread.
  const [terrainWorker, setTerrainWorker] = useState(true);
  const onTerrainError = useCallback((err?: unknown) => {
    const error = err as Error | undefined;
    // Normal camera movements (pan/zoom) abort in-flight tile requests; ignore them completely
    if (error?.name === 'AbortError' || error?.message?.includes('aborted')) return;
    terrainTileErrors++;
    if (terrainWorker && terrainTileErrors > 4) {
      terrainTileErrors = 0;
      setTerrainWorker(false);
    }
  }, [terrainWorker]);
  /**
   * The first terrain tile on screen tells the loading screen the map is drawn. A tile arriving
   * also clears the error count: it used to only ever climb, so a handful of transient failures
   * anywhere in a session eventually tripped the fallback to the coarse scenario DEM and left
   * every scenario loaded afterwards looking soft, with nothing to put it back.
   */
  const onTerrainTile = useCallback(() => {
    terrainTileErrors = 0;
    if (!useUiStore.getState().mapReady) useUiStore.getState().setMapReady(true);
  }, []);
  // Offline, the scenario's own DEM stands in for the world terrain; back online, the world returns.
  useEffect(() => {
    const online = () => setTerrainMode('world');
    const offline = () => setTerrainMode('local');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);
  const terrain = useLocalTerrain(terrainMode === 'local' && view.terrain3d);

  const [viewState, setViewState] = useState<MapViewState>({ longitude: 78.44, latitude: 30.22, zoom: 9.6, pitch: 55, bearing: -20 });
  const zoomStep = Math.round(viewState.zoom * 2) / 2;
  const [hover, setHover] = useState<Hover | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fly to each newly loaded scenario.
  useEffect(() => {
    if (!config) return;
    const [w, s, e, n] = config.bbox;
    const id = requestAnimationFrame(() => {
      setViewState((v) => ({
        ...v,
        longitude: (w + e) / 2,
        latitude: (s + n) / 2,
        zoom: config.view?.zoom ?? 10,
        pitch: view.terrain3d ? config.view?.pitch ?? 55 : 0,
        bearing: view.terrain3d ? config.view?.bearing ?? 0 : 0,
        transitionDuration: 1800,
        transitionInterpolator: new FlyToInterpolator({ speed: 1.6 }),
      }));
      setHover(null);
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.id]);

  // Tilt in and out with the 2D / 3D toggle.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setViewState((v) => ({
        ...v,
        pitch: view.terrain3d ? config?.view?.pitch ?? 55 : 0,
        bearing: view.terrain3d ? v.bearing : 0,
        transitionDuration: 900,
        transitionInterpolator: new FlyToInterpolator({ speed: 3 }),
      }));
      setHover(null);
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.terrain3d]);

  // Fly to a place selected in the list.
  useEffect(() => {
    if (selectedAsset === null || !exposure) return;
    const a = exposure.assets[selectedAsset];
    if (!a) return;
    const id = requestAnimationFrame(() => {
      setViewState((v) => ({
        ...v,
        longitude: a.lng,
        latitude: a.lat,
        zoom: Math.max(v.zoom, 12.4),
        transitionDuration: 1200,
        transitionInterpolator: new FlyToInterpolator({ speed: 1.8 }),
      }));
    });
    return () => cancelAnimationFrame(id);
  }, [selectedAsset, exposure]);

  // ---- Flood ------------------------------------------------------------------------------
  // While the flood plays, deck.gl redraws every frame and the flood shader reads the playhead
  // itself; when paused, moving the playhead asks for a single redraw.
  useEffect(
    () =>
      useSimStore.subscribe((s, prev) => {
        if (s.playhead !== prev.playhead && !(s.playing || (s.follow && isRunning(s.runs)))) deckRef.current?.deck?.redraw('playhead');
      }),
    [],
  );
  const hasFlood = hasResults || !!(observed && view.showObserved) || !!ensemble;



  // Ground elevation under each place, so markers and labels sit on the 3D terrain.
  const assetZ = useMemo(() => {
    if (!data || !exposure) return null;
    const g = data.grid;
    return Float32Array.from(exposure.assets, (a) => sampleBilinear(data.dem, g.cols, g.rows, (a.lng - g.bbox[0]) / g.lngStep, (g.bbox[3] - a.lat) / g.latStep));
  }, [data, exposure]);

  // Ways out that stay ahead of the water: computed asynchronously in a worker whenever a summary
  // arrives. Routes follow the clock: green while leaving now still reaches safety, red once cut off.
  const summaryTime = useSimStore((s) => {
    void s.summaryVersion;
    return results.get(primary)?.summary?.t ?? -1;
  });
  const [plannedRoutes, setPlannedRoutes] = useState<{ id: string; t: number; routes: EvacuationRoute[] } | null>(null);

  useEffect(() => {
    if (!data || !exposure || !view.showEvacuation || summaryTime < 0) return;
    const summary = results.get(primary)?.summary;
    if (!summary) return;
    let active = true;
    planEvacuation(exposure, data.grid, summary, { dem: data.dem }).then((routes) => {
      if (active) {
        setPlannedRoutes({ id: config?.id ?? '', t: summaryTime, routes: routes.filter((r) => r.path.length > 0) });
      }
    });
    return () => {
      active = false;
    };
  }, [config?.id, data, exposure, primary, summaryTime, view.showEvacuation]);

  const evacuation = useMemo(() => {
    if (!data || !exposure || !view.showEvacuation || summaryTime < 0) return null;
    if (!plannedRoutes || plannedRoutes.id !== (config?.id ?? '')) return null;
    return plannedRoutes.routes;
  }, [config?.id, data, exposure, plannedRoutes, summaryTime, view.showEvacuation]);

  const evacuationMap = useMemo(() => {
    if (!evacuation) return null;
    const map = new Map<number, EvacuationRoute>();
    for (const r of evacuation) map.set(r.asset, r);
    return map;
  }, [evacuation]);

  // Roads carry their own heights in 3D, so nothing has to be draped onto the terrain.
  const roadPaths3d = useMemo(() => {
    if (!data || !exposure) return null;
    const g = data.grid;
    return exposure.roads.map((r) =>
      r.path.map(([lng, lat]) => {
        const x = (lng - g.bbox[0]) / g.lngStep;
        const y = (g.bbox[3] - lat) / g.latStep;
        // Vertices just past the study-area edge take the edge's height: at z = 0 they drew
        // vertical streaks down to sea level.
        const cx = Math.min(g.cols - 1, Math.max(0, x));
        const cy = Math.min(g.rows - 1, Math.max(0, y));
        return [lng, lat, sampleBilinear(data.dem, g.cols, g.rows, cx, cy) + SKIN_LIFT + 4] as [number, number, number];
      }),
    );
  }, [data, exposure]);

  // ---- Particles (SPH) -------------------------------------------------------------------
  const particles = useMemo(() => {
    if (!engines.sph || !view.showParticles || (view.engine !== 'sph' && view.engine !== 'overlay')) return null;
    const r = results.get('sph');
    if (!r || sphFrame < 0) return null;
    const p = r.particles[sphFrame];
    if (!p) return null;
    const n = p.speed.length;
    let position = p.position;
    if (!view.terrain3d) {
      position = new Float32Array(p.position);
      for (let i = 0; i < n; i++) position[i * 3 + 2] = 0;
    }
    return { length: n, attributes: { getPosition: { value: position, size: 3 } } };
  }, [engines.sph, view.showParticles, view.engine, view.terrain3d, sphFrame]);

  // ---- Labels: towns and the worst-hit places, decluttered for the current zoom -------------
  const labels = useMemo(() => {
    if (!exposure) return [];
    const statuses = impacts?.statuses;
    const candidates: { index: number; priority: number }[] = [];
    exposure.assets.forEach((a, index) => {
      if (a.kind !== 'settlement' && index !== selectedAsset) return;
      const hazard = statuses?.[index]?.hazard ?? 0;
      let priority = -1;
      if (index === selectedAsset) priority = 100;
      else if (a.subtype === 'city') priority = 50;
      else if (a.subtype === 'town') priority = 40;
      else if (hazard >= 4) priority = 10 + hazard + Math.log10(a.population + 1);
      if (priority >= 0) candidates.push({ index, priority });
    });
    candidates.sort((x, y) => y.priority - x.priority);
    const lat = exposure.assets[0]?.lat ?? 25;
    const minGap = 110 * metresPerPixel(zoomStep, lat);
    const kept: { lng: number; lat: number }[] = [];
    const out: { a: (typeof exposure.assets)[number]; index: number }[] = [];
    for (const c of candidates) {
      const a = exposure.assets[c.index];
      const clash = kept.some((k) => Math.hypot((k.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180), (k.lat - a.lat) * 110_574) < minGap);
      if (clash && c.priority < 100) continue;
      kept.push(a);
      out.push({ a, index: c.index });
      if (out.length >= 28) break;
    }
    return out;
  }, [exposure, impacts, selectedAsset, zoomStep]);

  // Aerial perspective, coloured like the sky's horizon for the current basemap.
  const haze = useMemo(() => new HazeExtension({ color: view.basemap === 'satellite' ? HAZE_SATELLITE : HAZE_MAP, strength: 0.72 }), [view.basemap]);
  // Relief comes from a sun, not from the imagery. One directional light from the same quarter
  // the water shader puts its glints, so hillshade and glints agree instead of fighting, and a
  // sky fill tinted towards the horizon colour — kept close to white, because the dark map
  // basemap's horizon would otherwise leave the hillsides nearly black. The light travels
  // towards the scene, hence the negated direction.
  const lighting = useMemo(() => {
    const satellite = view.basemap === 'satellite';
    const sky = satellite ? HAZE_SATELLITE : HAZE_MAP;
    const tint = (c: number) => Math.round(255 * (0.65 + 0.35 * c));
    return [
      new LightingEffect({
        ambient: new AmbientLight({ color: [tint(sky[0]), tint(sky[1]), tint(sky[2])], intensity: 1 }),
        sun: new DirectionalLight({ color: [255, 250, 240], intensity: satellite ? 1.2 : 1, direction: [0.35, -0.45, -0.82] }),
      }),
    ];
  }, [view.basemap]);



  // ---- Map layers ------------------------------------------------------------------------
  const layers = useMemo(() => {
    if (!config || !data) return [];
    const bbox = data.grid.bbox;
    const list: unknown[] = [];

    const meshing = terrainWorker
      ? { loadOptions: { terrain: { workerUrl: TERRAIN_WORKER_URL } } }
      : { loaders: [TerrainLoader], loadOptions: { worker: false } };
    if (view.terrain3d && terrainMode === 'world') {
      const texture = view.basemap === 'satellite' ? IMAGERY_URL : MAP_TILES_URL;
      list.push(
        // High-resolution terrain everywhere, to the horizon (no margin, so no cliff where it
        // used to stop): tiles to zoom 17 (heights cut from Terrarium's zoom 15) with textures
        // stitched from imagery one zoom deeper, down to ~0.5 m per pixel; smooth normals,
        // finer meshes near the camera, and haze towards the horizon.
        new HiResTerrainLayer({
          // A new id when meshing falls back to the main thread or roads toggle, so tiles reload properly.
          id: `terrain-world-${view.basemap}-${view.showRoads ? 'r' : 'nr'}-${terrainWorker ? 'w' : 'm'}`,
          elevationData: TERRARIUM_URL,
          texture,
          textureMaxZoom: view.basemap === 'satellite' ? 18 : 16,
          roadsOverlay: view.showRoads ? ROADS_OVERLAY_URL : null,
          elevationDecoder: TERRARIUM_DECODER,
          maxZoom: 17,
          meshMaxError: 2,
          zoomOffset: gpuKind === 'discrete' ? 1 : 0,
          extensions: [haze, FLOOD_TERRAIN],
          // The tile servers speak HTTP/2: more requests in flight fill the view faster when zooming.
          maxRequests: 16,
          ...meshing,
          material: TERRAIN_MATERIAL,
          onTileError: onTerrainError,
          onTileLoad: onTerrainTile,
        } as never),
      );
    } else if (view.terrain3d && terrain && terrain.id === config.id) {
      list.push(
        new TerrainLayer({
          id: `terrain-${config.id}-${terrainWorker ? 'w' : 'm'}`,
          elevationData: terrain.elevation,
          texture: terrain.texture,
          bounds: bbox,
          elevationDecoder: TERRARIUM_DECODER,
          meshMaxError: 5,
          extensions: [haze, FLOOD_TERRAIN],
          ...meshing,
          loadOptions: { ...meshing.loadOptions, terrain: { ...(terrainWorker ? { workerUrl: TERRAIN_WORKER_URL } : {}), skirtHeight: 0 } },
          material: TERRAIN_MATERIAL,
        } as never),
      );
    }

    // Upstream reservoir: level-pool surface at T+0, dropping as breach water releases.
    // Mountain slopes naturally occlude the plane; the crest line cuts off downstream leakage.
    const reservoirPolygon = setup && config
      ? computeReservoirPolygon(setup, config, bbox, useSimStore.getState().playhead)
      : null;
    if (view.terrain3d && reservoirPolygon) {
      list.push(
        new PolygonLayer({
          id: 'reservoir',
          data: [{ polygon: reservoirPolygon }],
          getPolygon: (d: { polygon: [number, number, number][] }) => d.polygon,
          filled: true,
          stroked: false,
          _full3d: true,
          material: WATER_MATERIAL,
          getFillColor: [24, 88, 134, 215],
          parameters: { depthTest: true },
          extensions: [haze],
          updateTriggers: {
            getPolygon: [reservoirPolygon],
          },
        } as never),
      );
    }

    // In 2D flat view, the flood is drawn onto a bounding-box quad; in 3D, it is drawn inside the terrain shader.
    if (!view.terrain3d && hasFlood && BLANK_IMAGE) {
      list.push(
        new BitmapLayer({
          id: 'flood',
          image: BLANK_IMAGE,
          bounds: bbox,
          _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          extensions: [FLOOD],
        } as never),
      );
    }

    if (exposure && view.showRoads) {
      const cut = impacts?.impact.roadCut;
      list.push(
        new PathLayer({
          id: 'roads',
          data: exposure.roads,
          getPath: (d: { path: [number, number][] }, { index }: { index: number }) => (view.terrain3d && roadPaths3d ? roadPaths3d[index] : d.path),
          getColor: (_d: unknown, { index }: { index: number }) =>
            cut && cut[index] ? [208, 59, 59, 235] : [255, 255, 255, view.basemap === 'satellite' ? 110 : 70],
          getWidth: (_d: unknown, { index }: { index: number }) => (cut && cut[index] ? 3 : 1.2),
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          updateTriggers: { getPath: [view.terrain3d, roadPaths3d], getColor: [cut, view.basemap, view.terrain3d], getWidth: [cut] },
        }),
      );
    }

    if (particles) {
      const overlay = view.engine === 'overlay';
      const c = hexToRgb(IDENTITY.sph);
      list.push(
        new ScatterplotLayer({
          id: 'sph-particles',
          data: particles,
          getFillColor: overlay ? [c[0], c[1], c[2], 190] : [255, 255, 255, 150],
          getRadius: 1,
          radiusUnits: 'pixels',
          radiusMinPixels: 1.1,
          radiusMaxPixels: 2.2,
          stroked: false,
          parameters: { depthTest: view.terrain3d },
        }),
      );
    }

    // The way out, following the simulation clock: bright green while leaving now still reaches safety,
    // switching to red once cut off. Drawn depth-tested onto the terrain so routes follow the ground.
    if (evacuation && evacuation.length > 0 && view.showEvacuation) {
      const playhead = useSimStore.getState().playhead;
      const isUsable = (d: EvacuationRoute) => d.status === 'ok' && playhead <= d.latestDepartureSeconds;
      const routePath = (d: { path: [number, number][]; path3d?: [number, number, number][] }) =>
        (view.terrain3d && d.path3d ? d.path3d : d.path);
      list.push(
        new PathLayer({
          id: 'evacuation-halo',
          data: evacuation,
          getPath: routePath,
          getColor: (d: unknown) => (isUsable(d as EvacuationRoute) ? [34, 197, 94, 75] : [220, 38, 38, 75]),
          getWidth: 7,
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          parameters: { depthTest: view.terrain3d },
          updateTriggers: {
            getPath: [view.terrain3d],
            getColor: [Math.floor(playhead / 15)],
          },
        }),
        new PathLayer({
          id: 'evacuation',
          data: evacuation,
          getPath: routePath,
          getColor: (d: unknown) => (isUsable(d as EvacuationRoute) ? [34, 197, 94, 245] : [220, 38, 38, 245]),
          getWidth: 2.5,
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          parameters: { depthTest: view.terrain3d },
          updateTriggers: {
            getPath: [view.terrain3d],
            getColor: [Math.floor(playhead / 15)],
          },
        }),
      );
    }

    if (exposure && view.showAssets) {
      const statuses = impacts?.statuses;
      const hazardRgb = HAZARD_COLORS.map(hexToRgb);
      const lift = (index: number) => (view.terrain3d && assetZ ? assetZ[index] + 18 : 0);
      const flooded = (index: number) => (statuses?.[index]?.hazard ?? 0) > 0;
      // Dry villages and hamlets recede when zoomed out; towns and anything flooded stay clear.
      const far = zoomStep < 10.5;
      const baseRadius = (d: { kind: string; subtype: string }) =>
        d.kind === 'settlement' ? (d.subtype === 'city' ? 4.2 : d.subtype === 'town' ? 3.3 : d.subtype === 'village' ? (far ? 1.4 : 1.9) : far ? 1.1 : 1.5) : far ? 1.9 : 2.4;
      list.push(
        new ScatterplotLayer({
          id: 'assets',
          data: exposure.assets,
          pickable: true,
          getPosition: (d: { lng: number; lat: number }, { index }: { index: number }) => [d.lng, d.lat, lift(index)],
          getRadius: (d: { kind: string; subtype: string }, { index }: { index: number }) => baseRadius(d) + (flooded(index) ? 1.8 : 0),
          radiusUnits: 'pixels',
          stroked: true,
          lineWidthUnits: 'pixels',
          getLineWidth: (_d: unknown, { index }: { index: number }) => (index === selectedAsset ? 3 : flooded(index) ? 1.5 : 0.75),
          getFillColor: (d: { kind: string; subtype: string }, { index }: { index: number }) => {
            const s = statuses?.[index];
            if (s && s.hazard > 0) return [...hazardRgb[s.hazard - 1], 255] as [number, number, number, number];
            if (d.kind !== 'settlement') return [29, 29, 31, 200];
            return [255, 255, 255, far && d.subtype !== 'town' && d.subtype !== 'city' ? 120 : 175];
          },
          getLineColor: (_d: unknown, { index }: { index: number }) =>
            index === selectedAsset ? [245, 158, 11, 255] : flooded(index) ? [255, 255, 255, 255] : [0, 0, 0, 60],
          updateTriggers: {
            getPosition: [view.terrain3d, assetZ],
            getRadius: [statuses, far],
            getFillColor: [statuses, far],
            getLineColor: [selectedAsset, statuses],
            getLineWidth: [selectedAsset, statuses],
          },
        }),
      );
      list.push(
        new TextLayer({
          id: 'labels',
          data: labels,
          getPosition: (d: { a: { lng: number; lat: number }; index: number }) => [d.a.lng, d.a.lat, lift(d.index)],
          getText: (d: { a: { name: string } }) => displayName(d.a.name),
          getSize: (d: { a: { subtype: string } }) => (d.a.subtype === 'city' || d.a.subtype === 'town' ? 12.5 : 11),
          getColor: [242, 242, 242, 255],
          getPixelOffset: [0, -13],
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 600,
          fontSettings: { sdf: true, buffer: 6 },
          outlineWidth: 5,
          outlineColor: [5, 5, 5, 215],
          characterSet: 'auto',
          parameters: { depthTest: false },
          updateTriggers: { getPosition: [view.terrain3d, assetZ] },
        }),
      );
    }
    // The dam: a red marker with its name, raised on a thin stem in 3D, drawn over everything.
    // The imagery shows the structure itself; the marker says where the breach is.
    if (setup) {
      const bed = setup.site.bed;
      const z = view.terrain3d ? bed.elevation + config.dam.height + 80 : 0;
      const at = [{ position: [bed.lng, bed.lat, z] as [number, number, number] }];
      const position = (d: { position: [number, number, number] }) => d.position;
      if (view.terrain3d) {
        list.push(
          new PathLayer({
            id: 'dam-stem',
            data: [{ path: [[bed.lng, bed.lat, bed.elevation], [bed.lng, bed.lat, z]] }],
            getPath: (d: { path: [number, number, number][] }) => d.path,
            getColor: [208, 59, 59, 230],
            getWidth: 2,
            widthUnits: 'pixels',
          }),
        );
      }
      list.push(
        new ScatterplotLayer({
          id: 'dam-halo',
          data: at,
          getPosition: position,
          getRadius: 17,
          radiusUnits: 'pixels',
          getFillColor: [208, 59, 59, 55],
          stroked: true,
          getLineColor: [208, 59, 59, 150],
          getLineWidth: 1.5,
          lineWidthUnits: 'pixels',
          parameters: { depthTest: false },
        }),
        new ScatterplotLayer({
          id: 'dam-dot',
          data: at,
          getPosition: position,
          getRadius: 7,
          radiusUnits: 'pixels',
          getFillColor: [208, 59, 59, 255],
          stroked: true,
          getLineColor: [255, 255, 255, 255],
          getLineWidth: 2.5,
          lineWidthUnits: 'pixels',
          parameters: { depthTest: false },
        }),
        new TextLayer({
          id: 'dam-label',
          data: at,
          getPosition: position,
          getText: () => config.dam.name,
          getSize: 12.5,
          getColor: [255, 255, 255, 255],
          getPixelOffset: [0, -31],
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 600,
          background: true,
          getBackgroundColor: [29, 29, 31, 235],
          backgroundPadding: [9, 5],
          backgroundBorderRadius: 7,
          characterSet: 'auto',
          parameters: { depthTest: false },
          updateTriggers: { getText: [config.dam.name] },
        } as never),
      );
    }
    return list;
  }, [config, data, exposure, setup, terrain, terrainMode, terrainWorker, gpuKind, onTerrainError, onTerrainTile, hasFlood, roadPaths3d, evacuation, particles, impacts, view, selectedAsset, assetZ, labels, zoomStep, haze]);

  // ---- Hover: read the rasters under the cursor --------------------------------------------
  const onHover = useCallback(
    (info: PickingInfo) => {
      if (!data || info.x < 0 || info.y < 0) {
        setHover(null);
        return;
      }
      if (info.layer?.id === 'assets' && info.index >= 0 && exposure) {
        const a = exposure.assets[info.index];
        const s = impacts?.statuses[info.index];
        const lines = [a.kind === 'settlement' ? `${a.subtype} · ${formatNumber(a.population)} people${a.populationEstimated ? ' (est.)' : ''}` : a.subtype.replace('_', ' ')];
        if (s && s.maxDepth > 0) {
          lines.push(`Flood arrives T+${formatClock(s.arrival)} · peak ${formatDepth(s.maxDepth)}`);
          if (s.hazard) lines.push(`Hazard H${s.hazard}${s.maxSpeed ? ` · ${formatSpeed(s.maxSpeed)}` : ''}`);
        } else lines.push('Not reached so far');
        const ev = evacuationMap?.get(info.index);
        if (ev) {
          const t = useSimStore.getState().playhead;
          if (ev.status === 'ok') {
            if (t <= ev.latestDepartureSeconds) {
              lines.push(`Evacuation open · leaves by T+${formatClock(ev.latestDepartureSeconds)} (${formatNumber(ev.lengthM / 1000, 1)} km)`);
            } else {
              lines.push(`Evacuation CUT OFF since T+${formatClock(ev.latestDepartureSeconds)}`);
            }
          } else if (ev.status === 'cut-off') {
            lines.push('No safe evacuation route (cut off by flood)');
          }
        }
        setHover({ x: info.x, y: info.y, title: displayName(a.name), lines });
        return;
      }
      const g = data.grid;
      const elevAt = (lng: number, lat: number) => {
        const x = (lng - g.bbox[0]) / g.lngStep;
        const y = (g.bbox[3] - lat) / g.latStep;
        return x < 0 || y < 0 || x >= g.cols || y >= g.rows ? NaN : sampleBilinear(data.dem, g.cols, g.rows, x, y);
      };
      // In 3D the cursor ray meets the mountains, not sea level: march down the ray until it
      // passes under the DEM surface.
      let coord: number[] | null = info.coordinate ?? null;
      if (view.terrain3d && info.viewport) {
        coord = null;
        const [zMin, zMax] = data.demRange;
        const top = zMax + 60;
        const steps = 64;
        let prev: number[] | null = null;
        for (let i = 0; i <= steps; i++) {
          const z = top - (i / steps) * (top - zMin + 60);
          const p = info.viewport.unproject([info.x, info.y], { targetZ: z });
          const ground = elevAt(p[0], p[1]);
          if (Number.isFinite(ground) && ground >= z) {
            coord = prev ?? p;
            break;
          }
          prev = p;
        }
      }
      if (!coord) {
        setHover(null);
        return;
      }
      const [lng, lat] = coord;
      const cell = lngLatToCell(g, lng, lat);
      if (!cell) {
        setHover(null);
        return;
      }
      const r = results.get(primary);
      const loc = results.locate(primary, useSimStore.getState().playhead);
      const lines: string[] = [`Ground ${Math.round(elevAt(lng, lat))} m`];
      if (r && loc) {
        const d = r.depth[loc.i0][cell.index] / 100;
        if (d >= 0.1) lines.unshift(`Depth now ${formatDepth(d)}`);
        const s = r.summary;
        if (s && s.arrival[cell.index] >= 0) {
          lines.push(`Arrived T+${formatClock(s.arrival[cell.index])} · peak ${formatDepth(s.maxDepth[cell.index])}`);
          const hz = hazardClass(s.maxDepth[cell.index], s.maxSpeed[cell.index], s.maxDepthVelocity[cell.index]);
          if (hz) lines.push(`Hazard H${hz} · ${formatSpeed(s.maxSpeed[cell.index])}`);
        }
      }
      setHover({ x: info.x, y: info.y, title: `${lat.toFixed(4)}°N ${lng.toFixed(4)}°E`, lines });
    },
    [data, exposure, impacts, primary, view.terrain3d, evacuationMap],
  );

  const onClick = useCallback((info: PickingInfo) => {
    if (useUiStore.getState().pickingDam && info.coordinate) {
      window.dispatchEvent(new CustomEvent('cascade:pick', { detail: { lng: info.coordinate[0], lat: info.coordinate[1] } }));
      useUiStore.getState().setPickingDam(false);
      return;
    }
    // Clicking a place selects it; clicking empty map clears the selection.
    useSimStore.getState().selectAsset(info.layer?.id === 'assets' && info.index >= 0 ? info.index : null);
  }, []);

  // Keep hover cards inside the map.
  const [containerSize, setContainerSize] = useState({ width: 1600, height: 1000 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize({ width, height });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { width, height } = containerSize;

  if (!GPU.webgl2) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-canvas p-6">
        <div className="glass-strong max-w-md rounded-panel p-7 text-center shadow-panel">
          <div className="text-[17px] font-semibold tracking-[-0.02em]">This browser can’t draw the map</div>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Cascade needs WebGL 2. Update to a current version of Chrome, Edge, Firefox or Safari, and make sure hardware acceleration is switched on in the browser settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="absolute inset-0" onMouseLeave={() => setHover(null)}>
      <DeckGL
        ref={deckRef}
        // Continuous redraws only while the flood plays; otherwise deck.gl draws on change.
        _animate={animating}
        viewState={viewState}
        onViewStateChange={({ viewState: v }) => setViewState(v as MapViewState)}
        controller={{ inertia: 250, scrollZoom: { smooth: true, speed: 0.02 } }}
        layers={layers as never}
        layerFilter={pickOnlyPlaces as never}
        effects={lighting}
        onHover={onHover}
        onClick={onClick}
        onError={(err) => console.warn('[map]', err.message)}
        onDeviceInitialized={(device) => setMapGpu(device.info)}
        useDevicePixels={PIXEL_RATIO}
        deviceProps={{ webgl: { antialias: GPU.tier === 'high' } } as never}
        pickingRadius={6}
        getCursor={({ isDragging, isHovering }) => (pickingDam ? 'crosshair' : isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab')}
      >
        {/* In 3D the flat basemap stays under the terrain: wherever terrain tiles are still
            loading (a quick zoom out, a new area) or the terrain stops, the map shows imagery
            instead of a void. */}
        <MapGL
          reuseMaps
          mapStyle={
            (view.terrain3d && terrainMode === 'world'
              ? view.basemap === 'satellite'
                ? SATELLITE_STYLE_3D
                : LIGHT_STYLE_3D
              : view.basemap === 'satellite'
                ? SATELLITE_STYLE
                : LIGHT_STYLE) as never
          }
          attributionControl={false}
          // Under 3D terrain the flat basemap is mostly hidden or far off at the horizon: half
          // resolution (a quarter of the pixels) keeps it cheap next to the frosted panels.
          pixelRatio={view.terrain3d && terrainMode === 'world' ? 0.5 : PIXEL_RATIO}
          // In 3D world mode the first terrain tile marks the map ready instead.
          onLoad={() => !(view.terrain3d && terrainMode === 'world') && useUiStore.getState().setMapReady(true)}
        />
      </DeckGL>
      {hover && (
        <div
          className="glass-strong pointer-events-none absolute z-30 max-w-[260px] rounded-xl px-3 py-2 text-[12px] shadow-float"
          style={{ left: Math.min(hover.x + 14, width - 276), top: Math.min(hover.y + 14, height - 110) }}
        >
          <div className="font-semibold text-ink">{hover.title}</div>
          {hover.lines.map((l, i) => (
            <div key={i} className="tnum mt-0.5 text-muted">
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
