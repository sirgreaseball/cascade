'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import MapGL from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { COORDINATE_SYSTEM, FlyToInterpolator } from '@deck.gl/core';
import type { Layer, MapViewState, PickingInfo } from '@deck.gl/core';
import { BitmapLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { TerrainLayer } from '@deck.gl/geo-layers';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
// Main-thread terrain parser: deck.gl bundles only the worker loader, whose script would be
// fetched from a CDN at runtime (and fail offline).
import { TerrainLoader } from '@loaders.gl/terrain';
import { useScenarioStore } from '@/store/scenarioStore';
import { useSimStore } from '@/store/simulationStore';
import { useUiStore } from '@/store/uiStore';
import { results } from '@/simulation/results';
import { lngLatToCell, sampleBilinear } from '@/lib/geo/grid';
import { TERRARIUM_URL } from '@/lib/geo/terrarium';
import { hazardClass } from '@/lib/damage';
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
  paintVelocity,
} from './colormaps';
import { hillshadeDataUrl, IMAGERY_ATTRIBUTION, IMAGERY_URL, MAP_ATTRIBUTION, MAP_LABELS_URL, MAP_TILES_URL, satelliteDataUrl, terrariumDataUrl } from './terrain';
import { buildGridMesh } from './waterMesh';

const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    imagery: { type: 'raster' as const, tiles: [IMAGERY_URL], tileSize: 256, maxzoom: 19, attribution: IMAGERY_ATTRIBUTION },
  },
  layers: [
    { id: 'background', type: 'background' as const, paint: { 'background-color': '#dfe3e6' } },
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
    { id: 'background', type: 'background' as const, paint: { 'background-color': '#eceeef' } },
    { id: 'base', type: 'raster' as const, source: 'base' },
    { id: 'labels', type: 'raster' as const, source: 'labels' },
  ],
};
/**
 * Under 3D terrain the flat basemap only shows where terrain tiles are still loading or beyond
 * the terrain's reach, so 512-px tiles (a quarter as many) and no labels keep it cheap.
 */
const SATELLITE_STYLE_3D = { ...SATELLITE_STYLE, sources: { imagery: { ...SATELLITE_STYLE.sources.imagery, tileSize: 512 } } };
const LIGHT_STYLE_3D = {
  ...LIGHT_STYLE,
  sources: { base: { ...LIGHT_STYLE.sources.base, tileSize: 512 } },
  layers: LIGHT_STYLE.layers.filter((l) => l.id !== 'labels'),
};
/** Copied from node_modules by scripts/copy-workers.mjs: terrain meshing off the main thread. */
const TERRAIN_WORKER_URL = '/workers/terrain-worker.js';
/** Rendering resolution cap: full sharpness on normal screens, 1.5× on high-DPI ones. */
const PIXEL_RATIO = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;

const TERRARIUM_DECODER = { rScaler: 256, gScaler: 1, bScaler: 1 / 256, offset: -32768 };
const TERRAIN_MATERIAL = { ambient: 0.62, diffuse: 0.55, shininess: 8, specularColor: [30, 30, 30] as [number, number, number] };
const WATER_MATERIAL = { ambient: 0.8, diffuse: 0.35, shininess: 48, specularColor: [70, 70, 70] as [number, number, number] };
/** Share of the study-area size that close-in 3D terrain extends beyond it on every side. */
const TERRAIN_MARGIN = 1;
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
  /** The first terrain tile on screen tells the loading screen the map is drawn. */
  const onTerrainTile = useCallback(() => {
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
    return new ImageData(out, cols, rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, primary, playhead, version, view.layer, external, observed, view.showObserved]);

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
      // Close in, detailed terrain stops a margin beyond the study area (distant ground filled
      // much of the GPU frame) and the flat basemap underneath carries on to the horizon. Zoomed
      // out past the scenario's framing, tiles are coarse and cheap, so terrain runs everywhere.
      const mw = (bbox[2] - bbox[0]) * TERRAIN_MARGIN;
      const mh = (bbox[3] - bbox[1]) * TERRAIN_MARGIN;
      const zoomedOut = zoomStep < (config.view?.zoom ?? 10) - 0.5;
      list.push(
        new TerrainLayer({
          id: `terrain-world-${view.basemap}-${terrainWorker ? 'w' : 'm'}`,
          elevationData: TERRARIUM_URL,
          texture,
          elevationDecoder: TERRARIUM_DECODER,
          maxZoom: 14,
          meshMaxError: 8,
          extent: zoomedOut ? undefined : [bbox[0] - mw, bbox[1] - mh, bbox[2] + mw, bbox[3] + mh],
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
            cut && cut[index] ? [208, 59, 59, 235] : view.basemap === 'satellite' ? [255, 255, 255, 110] : [60, 60, 67, 90],
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
            index === selectedAsset ? [0, 113, 227, 255] : flooded(index) ? [255, 255, 255, 255] : [0, 0, 0, 60],
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
          getColor: [29, 29, 31, 255],
          getPixelOffset: [0, -13],
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight: 600,
          fontSettings: { sdf: true, buffer: 6 },
          outlineWidth: 5,
          outlineColor: [255, 255, 255, 235],
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
  }, [config, data, exposure, setup, terrain, terrainMode, terrainWorker, onTerrainError, onTerrainTile, image, skin, roadPaths3d, particles, impacts, view, selectedAsset, assetZ, labels, zoomStep]);

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
      <div className="absolute inset-0 flex items-center justify-center bg-[#e9ecee] p-6">
        <div className="max-w-md rounded-panel bg-white p-7 text-center shadow-panel">
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
          pixelRatio={PIXEL_RATIO}
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
