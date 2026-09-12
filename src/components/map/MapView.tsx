'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import MapGL from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { AmbientLight, COORDINATE_SYSTEM, DirectionalLight, FlyToInterpolator, LightingEffect } from '@deck.gl/core';
import type { Layer, MapViewState, PickingInfo } from '@deck.gl/core';
import { BitmapLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { TerrainLayer } from '@deck.gl/geo-layers';
import { HiResTerrainLayer } from './hiResTerrain';
import { HazeExtension } from './haze';
import { WaterExtension } from './water';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
// Main-thread terrain parser: deck.gl bundles only the worker loader, whose script would be
// fetched from a CDN at runtime (and fail offline).
import { TerrainLoader } from '@loaders.gl/terrain';
import { useEnsembleStore } from '@/store/ensembleStore';
import { useScenarioStore } from '@/store/scenarioStore';
import { useSimStore } from '@/store/simulationStore';
import { useUiStore } from '@/store/uiStore';
import { results } from '@/simulation/results';
import { lngLatToCell, sampleBilinear } from '@/lib/geo/grid';
import { TERRARIUM_URL } from '@/lib/geo/terrarium';
import { hazardClass } from '@/lib/damage';
import { planEvacuation } from '@/lib/evacuation';
import { formatClock, formatDepth, formatSpeed, formatNumber } from '@/lib/format';
import { displayName } from '@/lib/text';
import { detectGpu } from '@/lib/gpu';
import { usePrimaryEngine, useImpacts } from '@/components/useSimView';
import {
  HAZARD_COLORS,
  hexToRgb,
  IDENTITY,
  paintArrival,
  paintDepth,
  paintDifference,
  paintDifferenceMetres,
  paintHazard,
  paintMaxDepth,
  paintProbability,
  paintVelocity,
} from './colormaps';
import { hillshadeDataUrl, IMAGERY_ATTRIBUTION, IMAGERY_URL, MAP_ATTRIBUTION, MAP_LABELS_URL, MAP_TILES_URL, satelliteDataUrl, terrariumDataUrl } from './terrain';
import { buildGridMesh } from './waterMesh';

/** Sky and horizon glow above the 3D terrain; the horizon matches the terrain's haze. */
const SKY_SATELLITE = { 'sky-color': '#3b6186', 'horizon-color': '#aebfd0', 'fog-color': '#aebfd0', 'sky-horizon-blend': 0.55, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.85 };
const SKY_MAP = { 'sky-color': '#07080a', 'horizon-color': '#1d2127', 'fog-color': '#1d2127', 'sky-horizon-blend': 0.55, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.85 };

const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    imagery: { type: 'raster' as const, tiles: [IMAGERY_URL], tileSize: 256, maxzoom: 19, attribution: IMAGERY_ATTRIBUTION },
  },
  layers: [
    { id: 'background', type: 'background' as const, paint: { 'background-color': '#0b0b0c' } },
    { id: 'imagery', type: 'raster' as const, source: 'imagery', paint: { 'raster-saturation': -0.22, 'raster-contrast': 0.04, 'raster-brightness-max': 0.96 } },
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
  layers: noFade(SATELLITE_STYLE.layers),
  sky: SKY_SATELLITE,
};
const LIGHT_STYLE_3D = {
  ...LIGHT_STYLE,
  sources: { base: { ...LIGHT_STYLE.sources.base, tileSize: 512 } },
  layers: noFade(LIGHT_STYLE.layers.filter((l) => l.id !== 'labels')),
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
  const [tex, setTex] = useState<{ id: string; elevation: string; texture: string } | null>(null);
  useEffect(() => {
    if (!enabled || !config || !data) return;
    let cancelled = false;
    const elevation = terrariumDataUrl(data.dem, data.grid.cols, data.grid.rows);
    setTex({ id: config.id, elevation, texture: hillshadeDataUrl(data.dem, data.grid) });
    if (typeof navigator === 'undefined' || navigator.onLine) {
      satelliteDataUrl(data.grid.bbox).then((sat) => {
        if (!cancelled && sat) setTex({ id: config.id, elevation, texture: sat });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [enabled, config, data]);
  return tex;
}

const metresPerPixel = (zoom: number, lat: number) => (156_543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;

export default function MapView() {
  const config = useScenarioStore((s) => s.config);
  const data = useScenarioStore((s) => s.data);
  const exposure = useScenarioStore((s) => s.exposure);
  const observed = useScenarioStore((s) => s.observed);
  const external = useScenarioStore((s) => s.external);
  const ensemble = useEnsembleStore((s) => s.result);
  const setup = useSimStore((s) => s.setup);
  const view = useSimStore((s) => s.view);
  const engines = useSimStore((s) => s.engines);
  // The flood repaints at a fixed wall-clock rate (~15 Hz), not every animation tick: each
  // repaint re-colours the grid and uploads one texture.
  const playhead = useSimStore((s) => {
    const q = Math.max(1, s.speed / 15);
    return Math.floor(s.playhead / q) * q;
  });
  const version = useSimStore((s) => s.resultsVersion);
  const selectedAsset = useSimStore((s) => s.selectedAsset);
  const pickingDam = useUiStore((s) => s.pickingDam);
  const primary = usePrimaryEngine();
  const impacts = useImpacts(primary);
  // Seamless world terrain from the same SRTM tiles when online; the scenario DEM block offline.
  const [terrainMode, setTerrainMode] = useState<'world' | 'local'>(() => (typeof navigator !== 'undefined' && !navigator.onLine ? 'local' : 'world'));
  // Mesh terrain in a worker; if the worker cannot start, fall back to the main thread.
  const [terrainWorker, setTerrainWorker] = useState(true);
  const tileErrors = useRef(0);
  const onTerrainError = useCallback(() => {
    tileErrors.current++;
    if (terrainWorker && tileErrors.current > 2) {
      tileErrors.current = 0;
      setTerrainWorker(false);
    } else if (tileErrors.current > 6) setTerrainMode('local');
  }, [terrainWorker]);
  /**
   * The first terrain tile on screen tells the loading screen the map is drawn. A tile arriving
   * also clears the error count: it used to only ever climb, so a handful of transient failures
   * anywhere in a session eventually tripped the fallback to the coarse scenario DEM and left
   * every scenario loaded afterwards looking soft, with nothing to put it back.
   */
  const onTerrainTile = useCallback(() => {
    tileErrors.current = 0;
    if (!useUiStore.getState().mapReady) useUiStore.getState().setMapReady(true);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.id]);

  // Tilt in and out with the 2D / 3D toggle.
  useEffect(() => {
    setViewState((v) => ({
      ...v,
      pitch: view.terrain3d ? config?.view?.pitch ?? 55 : 0,
      bearing: view.terrain3d ? v.bearing : 0,
      transitionDuration: 900,
      transitionInterpolator: new FlyToInterpolator({ speed: 3 }),
    }));
    setHover(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.terrain3d]);

  // Fly to a place selected in the list.
  useEffect(() => {
    if (selectedAsset === null || !exposure) return;
    const a = exposure.assets[selectedAsset];
    if (!a) return;
    setViewState((v) => ({
      ...v,
      longitude: a.lng,
      latitude: a.lat,
      zoom: Math.max(v.zoom, 12.4),
      transitionDuration: 1200,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.8 }),
    }));
  }, [selectedAsset, exposure]);

  // ---- Flood raster, painted into ping-pong buffers --------------------------------------
  const buffers = useRef<{ a: Uint8ClampedArray<ArrayBuffer>; b: Uint8ClampedArray<ArrayBuffer>; flip: boolean; n: number } | null>(null);
  const image = useMemo(() => {
    if (!data) return null;
    const { cols, rows } = data.grid;
    const n = cols * rows * 4;
    if (!buffers.current || buffers.current.n !== n) buffers.current = { a: new Uint8ClampedArray(n), b: new Uint8ClampedArray(n), flip: false, n };
    const buf = buffers.current;
    buf.flip = !buf.flip;
    const out = buf.flip ? buf.a : buf.b;
    const r = results.get(primary);
    const t = playhead;
    let painted = false;
    if (view.layer === 'depth') {
      const loc = results.locate(primary, t);
      if (r && loc) {
        paintDepth(out, r.depth[loc.i0], loc.i1 !== loc.i0 ? r.depth[loc.i1] : null, loc.f);
        painted = true;
      }
    } else if (view.layer === 'difference') {
      const a = results.get('swe');
      const b = results.get('sph');
      const la = results.locate('swe', t);
      const lb = results.locate('sph', t);
      if (a && b && la && lb) {
        paintDifference(out, a.depth[la.i0], b.depth[lb.i0]);
        painted = true;
      } else if (external && a?.summary) {
        paintDifferenceMetres(out, a.summary.maxDepth, external.maxDepth);
        painted = true;
      }
    } else if (view.layer === 'probability') {
      if (ensemble) {
        paintProbability(out, ensemble.probability);
        painted = true;
      }
    } else if (r?.summary) {
      const s = r.summary;
      if (view.layer === 'maxDepth') paintMaxDepth(out, s.maxDepth, s.arrival, t);
      else if (view.layer === 'arrival') paintArrival(out, s.arrival, t);
      else if (view.layer === 'hazard') paintHazard(out, s.maxDepth, s.maxSpeed, s.maxDepthVelocity, s.arrival, t);
      else if (view.layer === 'velocity') paintVelocity(out, s.maxSpeed, s.arrival, t);
      painted = true;
    }
    // The observed (satellite) extent shares the texture: it shows wherever the model is dry.
    const mask = observed && view.showObserved ? observed.mask : null;
    if (mask) {
      if (!painted) out.fill(0);
      const [or, og, ob] = hexToRgb(IDENTITY.observed);
      for (let k = 0; k < mask.length; k++) {
        const o = k * 4;
        if (mask[k] && out[o + 3] === 0) {
          out[o] = or;
          out[o + 1] = og;
          out[o + 2] = ob;
          out[o + 3] = 125;
        }
      }
      painted = true;
    }
    if (!painted) return null;
    // Soften the last cells at the study-area edge: water leaving through the open boundary
    // fades out instead of stopping on a hard straight line.
    const FEATHER = 8;
    const fade = (k: number, d: number) => {
      if (d < FEATHER) out[k * 4 + 3] = Math.round((out[k * 4 + 3] * (d + 0.5)) / FEATHER);
    };
    for (let r = 0; r < rows; r++) {
      const dr = Math.min(r, rows - 1 - r);
      if (dr < FEATHER) {
        for (let c = 0; c < cols; c++) fade(r * cols + c, Math.min(dr, c, cols - 1 - c));
        continue;
      }
      for (let c = 0; c < FEATHER; c++) {
        fade(r * cols + c, c);
        fade(r * cols + cols - 1 - c, c);
      }
    }
    return new ImageData(out, cols, rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, primary, playhead, version, view.layer, external, ensemble, observed, view.showObserved]);

  // The water skin: the scenario DEM as a mesh, lifted clear of the terrain, textured with the
  // flood, and only where ground lies below the crest (higher ground can never flood).
  const crestElevation = setup?.site.crestElevation ?? Infinity;
  const skin = useMemo(() => (data ? buildGridMesh(data.dem, data.grid, SKIN_LIFT, 200_000, crestElevation + 30) : null), [data, crestElevation]);

  // Ground elevation under each place, so markers and labels sit on the 3D terrain.
  const assetZ = useMemo(() => {
    if (!data || !exposure) return null;
    const g = data.grid;
    return Float32Array.from(exposure.assets, (a) => sampleBilinear(data.dem, g.cols, g.rows, (a.lng - g.bbox[0]) / g.lngStep, (g.bbox[3] - a.lat) / g.latStep));
  }, [data, exposure]);

  // Ways out that stay ahead of the water: only recomputed when a new envelope lands, never per
  // frame, and lifted onto the terrain so a route is not buried under the hillside in 3D.
  // Only once the run has finished: summaries land every fifth frame, and rebuilding the road
  // graph and re-routing every settlement that often would stall playback on the main thread.
  const routesReady = useSimStore((s) => {
    void s.resultsVersion;
    return s.runs[primary].status === 'done' ? results.get(primary)?.summary?.t ?? -1 : -1;
  });
  const evacuation = useMemo(() => {
    if (!data || !exposure || !view.showEvacuation || routesReady < 0) return null;
    const summary = results.get(primary)?.summary;
    if (!summary) return null;
    const g = data.grid;
    const lift = ([lng, lat]: [number, number]): [number, number, number] => {
      const x = Math.min(g.cols - 1, Math.max(0, (lng - g.bbox[0]) / g.lngStep));
      const y = Math.min(g.rows - 1, Math.max(0, (g.bbox[3] - lat) / g.latStep));
      return [lng, lat, sampleBilinear(data.dem, g.cols, g.rows, x, y) + SKIN_LIFT + 6];
    };
    return planEvacuation(exposure, g, summary)
      .filter((r) => r.status === 'ok' && r.path.length > 1)
      .map((r) => ({ ...r, path3d: r.path.map(lift) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, exposure, primary, routesReady, view.showEvacuation]);

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
    const loc = results.locate('sph', playhead);
    if (!r || !loc) return null;
    const p = r.particles[loc.i0];
    if (!p) return null;
    const n = p.speed.length;
    let position = p.position;
    if (!view.terrain3d) {
      position = new Float32Array(p.position);
      for (let i = 0; i < n; i++) position[i * 3 + 2] = 0;
    }
    return { length: n, attributes: { getPosition: { value: position, size: 3 } } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engines.sph, view.showParticles, view.engine, view.terrain3d, playhead, version]);

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

  // The flood's water surface: glints on ripples and the sky mirrored at grazing angles.
  const water = useMemo(
    () => (data ? new WaterExtension({ cols: data.grid.cols, rows: data.grid.rows, sky: view.basemap === 'satellite' ? HAZE_SATELLITE : HAZE_MAP }) : null),
    [data, view.basemap],
  );

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
          id: `terrain-world-${view.basemap}-${terrainWorker ? 'w' : 'm'}`,
          elevationData: TERRARIUM_URL,
          texture,
          textureMaxZoom: view.basemap === 'satellite' ? 18 : 16,
          elevationDecoder: TERRARIUM_DECODER,
          maxZoom: 17,
          meshMaxError: 2,
          extensions: [haze],
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
          ...meshing,
          loadOptions: { ...meshing.loadOptions, terrain: { ...(terrainWorker ? { workerUrl: TERRAIN_WORKER_URL } : {}), skirtHeight: 0 } },
          material: TERRAIN_MATERIAL,
        } as never),
      );
    }

    if (image && view.terrain3d && skin) {
      list.push(
        new SimpleMeshLayer({
          id: 'flood-skin',
          data: [0],
          mesh: skin.mesh as never,
          texture: image,
          getPosition: () => [skin.anchor[0], skin.anchor[1], 0],
          getColor: [255, 255, 255, 255],
          material: WATER_MATERIAL,
          textureParameters: { minFilter: 'linear', magFilter: 'linear' },
          parameters: { depthWriteEnabled: false },
          extensions: water ? [water, haze] : [haze],
          // Ripples follow simulated time (10-minute units): they move while the flood plays.
          waterTime: playhead / 600,
        } as never),
      );
    } else if (image) {
      list.push(
        new BitmapLayer({
          id: 'flood',
          image,
          bounds: bbox,
          _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          textureParameters: { minFilter: 'linear', magFilter: 'linear' },
        }),
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

    // The way out, drawn over the roads the water cuts: a soft halo so it reads against both the
    // satellite imagery and the flood, with the route itself thin and bright on top.
    if (evacuation && evacuation.length > 0) {
      const [gr, gg, gb] = hexToRgb(IDENTITY.external);
      const routePath = (d: { path: [number, number][]; path3d: [number, number, number][] }) => (view.terrain3d ? d.path3d : d.path);
      list.push(
        new PathLayer({
          id: 'evacuation-halo',
          data: evacuation,
          getPath: routePath,
          getColor: [gr, gg, gb, 70],
          getWidth: 7,
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          parameters: { depthTest: false },
          updateTriggers: { getPath: [view.terrain3d] },
        }),
        new PathLayer({
          id: 'evacuation',
          data: evacuation,
          getPath: routePath,
          getColor: [gr, gg, gb, 245],
          getWidth: 2.5,
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          parameters: { depthTest: false },
          updateTriggers: { getPath: [view.terrain3d] },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, data, exposure, setup, terrain, terrainMode, terrainWorker, onTerrainError, onTerrainTile, image, skin, roadPaths3d, evacuation, particles, impacts, view, selectedAsset, assetZ, labels, zoomStep, haze, water, playhead]);

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
    [data, exposure, impacts, primary, view.terrain3d],
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
  const width = containerRef.current?.clientWidth ?? 1600;
  const height = containerRef.current?.clientHeight ?? 1000;

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
        viewState={viewState}
        onViewStateChange={({ viewState: v }) => setViewState(v as MapViewState)}
        controller={{ inertia: 250, scrollZoom: { smooth: true, speed: 0.02 } }}
        layers={layers as never}
        layerFilter={pickOnlyPlaces as never}
        effects={lighting}
        onHover={onHover}
        onClick={onClick}
        onError={(err) => console.warn('[map]', err.message)}
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
