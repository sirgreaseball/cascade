'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import MapGL from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { COORDINATE_SYSTEM, FlyToInterpolator } from '@deck.gl/core';
import type { MapViewState, PickingInfo } from '@deck.gl/core';
import { BitmapLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { TerrainLayer } from '@deck.gl/geo-layers';
import { _TerrainExtension as TerrainExtension } from '@deck.gl/extensions';
// Main-thread terrain parser: deck.gl bundles only the worker loader, whose script would be
// fetched from a CDN at runtime (and fail offline).
import { TerrainLoader } from '@loaders.gl/terrain';
import { useScenarioStore } from '@/store/scenarioStore';
import { useSimStore } from '@/store/simulationStore';
import { useUiStore } from '@/store/uiStore';
import { results } from '@/simulation/results';
import { lngLatToCell, sampleBilinear } from '@/lib/geo/grid';
import { hazardClass } from '@/lib/damage';
import { formatClock, formatDepth, formatSpeed, formatNumber } from '@/lib/format';
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
  paintMask,
  paintMaxDepth,
  paintVelocity,
} from './colormaps';
import { hillshadeDataUrl, IMAGERY_ATTRIBUTION, IMAGERY_URL, satelliteDataUrl, terrariumDataUrl } from './terrain';
import { TERRARIUM_URL } from '@/lib/geo/terrarium';

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
const LIGHT_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const TERRARIUM_DECODER = { rScaler: 256, gScaler: 1, bScaler: 1 / 256, offset: -32768 };
const TERRAIN_MATERIAL = { ambient: 0.62, diffuse: 0.55, shininess: 8, specularColor: [30, 30, 30] as [number, number, number] };
const terrainExt = new TerrainExtension();

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

export default function MapView() {
  const config = useScenarioStore((s) => s.config);
  const data = useScenarioStore((s) => s.data);
  const exposure = useScenarioStore((s) => s.exposure);
  const observed = useScenarioStore((s) => s.observed);
  const external = useScenarioStore((s) => s.external);
  const setup = useSimStore((s) => s.setup);
  const view = useSimStore((s) => s.view);
  const engines = useSimStore((s) => s.engines);
  // The map repaints at ~15 Hz of wall-clock time, not every animation tick: each repaint
  // re-uploads the flood texture and re-drapes it on the terrain.
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
  const tileErrors = useRef(0);
  const terrain = useLocalTerrain(terrainMode === 'local' && view.terrain3d);

  const [viewState, setViewState] = useState<MapViewState>({ longitude: 78.44, latitude: 30.22, zoom: 9.6, pitch: 55, bearing: -20 });
  const [hover, setHover] = useState<Hover | null>(null);

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
    const eng = primary;
    const r = results.get(eng);
    const t = playhead;
    const locate = (e: 'swe' | 'sph') => results.locate(e, t);
    let painted = false;
    if (view.layer === 'depth') {
      const loc = locate(eng);
      if (r && loc) {
        paintDepth(out, r.depth[loc.i0], loc.i1 !== loc.i0 ? r.depth[loc.i1] : null, loc.f);
        painted = true;
      }
    } else if (view.layer === 'difference') {
      const a = results.get('swe');
      const b = results.get('sph');
      const la = locate('swe');
      const lb = locate('sph');
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
    if (!painted) return null;
    return new ImageData(out, cols, rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, primary, playhead, version, view.layer, external]);

  // Ground elevation under each place, so markers and labels sit on the 3D terrain.
  const assetZ = useMemo(() => {
    if (!data || !exposure) return null;
    const g = data.grid;
    return Float32Array.from(exposure.assets, (a) => sampleBilinear(data.dem, g.cols, g.rows, (a.lng - g.bbox[0]) / g.lngStep, (g.bbox[3] - a.lat) / g.latStep));
  }, [data, exposure]);

  const observedImage = useMemo(() => {
    if (!data || !observed) return null;
    const out = new Uint8ClampedArray(data.grid.cols * data.grid.rows * 4);
    paintMask(out, observed.mask);
    return new ImageData(out, data.grid.cols, data.grid.rows);
  }, [data, observed]);

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

  // ---- Map layers ------------------------------------------------------------------------
  const layers = useMemo(() => {
    if (!config || !data) return [];
    const bbox = data.grid.bbox;
    const drape = view.terrain3d ? [terrainExt] : [];
    const list: unknown[] = [];

    if (view.terrain3d && terrainMode === 'world') {
      list.push(
        new TerrainLayer({
          id: 'terrain-world',
          elevationData: TERRARIUM_URL,
          texture: IMAGERY_URL,
          elevationDecoder: TERRARIUM_DECODER,
          maxZoom: 14,
          meshMaxError: 3,
          operation: 'terrain+draw',
          loaders: [TerrainLoader],
          loadOptions: { worker: false },
          material: TERRAIN_MATERIAL,
          onTileError: () => {
            tileErrors.current++;
            if (tileErrors.current > 6) setTerrainMode('local');
          },
        }),
      );
    } else if (view.terrain3d && terrain && terrain.id === config.id) {
      list.push(
        new TerrainLayer({
          id: `terrain-${config.id}`,
          elevationData: terrain.elevation,
          texture: terrain.texture,
          bounds: bbox,
          elevationDecoder: TERRARIUM_DECODER,
          meshMaxError: 4,
          operation: 'terrain+draw',
          loaders: [TerrainLoader],
          loadOptions: { worker: false, terrain: { skirtHeight: 0 } },
          material: TERRAIN_MATERIAL,
        }),
      );
    }

    if (observedImage && view.showObserved) {
      list.push(
        new BitmapLayer({
          id: 'observed',
          image: observedImage,
          bounds: bbox,
          _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          textureParameters: { minFilter: 'nearest', magFilter: 'nearest' },
          extensions: drape,
        }),
      );
    }

    if (image) {
      list.push(
        new BitmapLayer({
          id: 'flood',
          image,
          bounds: bbox,
          _imageCoordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          textureParameters: { minFilter: 'linear', magFilter: 'linear' },
          extensions: drape,
          updateTriggers: { image: [playhead, view.layer] },
        }),
      );
    }

    if (exposure && view.showRoads) {
      const cut = impacts?.impact.roadCut;
      list.push(
        new PathLayer({
          id: 'roads',
          data: exposure.roads,
          getPath: (d: { path: [number, number][] }) => d.path,
          getColor: (_d: unknown, { index }: { index: number }) =>
            cut && cut[index] ? [208, 59, 59, 235] : view.basemap === 'satellite' ? [255, 255, 255, 120] : [60, 60, 67, 90],
          getWidth: (_d: unknown, { index }: { index: number }) => (cut && cut[index] ? 3 : 1.25),
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
          extensions: drape,
          updateTriggers: { getColor: [cut, view.basemap], getWidth: [cut] },
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

    // Dam: an extruded wall along the detected axis.
    if (setup) {
      const [a, b] = setup.site.axis;
      const midLat = (a[1] + b[1]) / 2;
      const mLng = 111_320 * Math.cos((midLat * Math.PI) / 180);
      const len = Math.hypot((b[0] - a[0]) * mLng, (b[1] - a[1]) * 110_574) || 1;
      const nx = (-(b[1] - a[1]) * 110_574) / len;
      const ny = ((b[0] - a[0]) * mLng) / len;
      const half = 28;
      const off = (p: [number, number], s: number): [number, number, number] => [
        p[0] + (nx * half * s) / mLng,
        p[1] + (ny * half * s) / 110_574,
        view.terrain3d ? setup.site.bed.elevation : 0,
      ];
      list.push(
        new SolidPolygonLayer({
          id: 'dam',
          data: [{ polygon: [off(a, 1), off(b, 1), off(b, -1), off(a, -1)] }],
          getPolygon: (d: { polygon: [number, number, number][] }) => d.polygon,
          extruded: view.terrain3d,
          getElevation: config.dam.height,
          getFillColor: [236, 234, 228, 255],
          material: { ambient: 0.7, diffuse: 0.6 },
        }),
      );
      list.push(
        new ScatterplotLayer({
          id: 'breach',
          data: [setup.site.bed],
          getPosition: (d: { lng: number; lat: number; elevation: number }) => [d.lng, d.lat, view.terrain3d ? d.elevation + config.dam.height + 20 : 0],
          getFillColor: [208, 59, 59, 255],
          getLineColor: [255, 255, 255, 255],
          lineWidthMinPixels: 2,
          stroked: true,
          radiusMinPixels: 5,
          radiusMaxPixels: 5,
        }),
      );
    }

    if (exposure && view.showAssets) {
      const statuses = impacts?.statuses;
      const hazardRgb = HAZARD_COLORS.map(hexToRgb);
      const lift = (index: number) => (view.terrain3d && assetZ ? assetZ[index] + 18 : 0);
      const flooded = (index: number) => (statuses?.[index]?.hazard ?? 0) > 0;
      const baseRadius = (d: { population: number; kind: string; subtype: string }) =>
        d.kind === 'settlement' ? (d.subtype === 'city' ? 4.2 : d.subtype === 'town' ? 3.3 : d.subtype === 'village' ? 1.9 : 1.5) : 2.4;
      list.push(
        new ScatterplotLayer({
          id: 'assets',
          data: exposure.assets,
          pickable: true,
          getPosition: (d: { lng: number; lat: number }, { index }: { index: number }) => [d.lng, d.lat, lift(index)],
          getRadius: (d: { population: number; kind: string; subtype: string }, { index }: { index: number }) => baseRadius(d) + (flooded(index) ? 1.8 : 0),
          radiusUnits: 'pixels',
          stroked: true,
          lineWidthUnits: 'pixels',
          getLineWidth: (_d: unknown, { index }: { index: number }) => (index === selectedAsset ? 3 : flooded(index) ? 1.5 : 0.75),
          getFillColor: (d: { kind: string }, { index }: { index: number }) => {
            const s = statuses?.[index];
            if (s && s.hazard > 0) return [...hazardRgb[s.hazard - 1], 255] as [number, number, number, number];
            return d.kind === 'settlement' ? [255, 255, 255, 170] : [29, 29, 31, 200];
          },
          getLineColor: (_d: unknown, { index }: { index: number }) =>
            index === selectedAsset ? [0, 113, 227, 255] : flooded(index) ? [255, 255, 255, 255] : [0, 0, 0, 70],
          updateTriggers: {
            getPosition: [view.terrain3d, assetZ],
            getRadius: [statuses],
            getFillColor: [statuses],
            getLineColor: [selectedAsset, statuses],
            getLineWidth: [selectedAsset, statuses],
          },
        }),
      );
      // Towns always; otherwise the most populous places under serious hazard, and the selection.
      const hit = exposure.assets
        .map((a, index) => ({ a, index }))
        .filter(({ a, index }) => a.kind === 'settlement' && a.subtype !== 'city' && a.subtype !== 'town' && (statuses?.[index]?.hazard ?? 0) >= 4)
        .sort((x, y) => y.a.population - x.a.population)
        .slice(0, 14);
      const labelled = [
        ...exposure.assets.map((a, index) => ({ a, index })).filter(({ a, index }) => (a.kind === 'settlement' && (a.subtype === 'city' || a.subtype === 'town')) || index === selectedAsset),
        ...hit,
      ];
      list.push(
        new TextLayer({
          id: 'labels',
          data: labelled,
          getPosition: (d: { a: { lng: number; lat: number }; index: number }) => [d.a.lng, d.a.lat, lift(d.index)],
          getText: (d: { a: { name: string } }) => d.a.name,
          getSize: (d: { a: { subtype: string } }) => (d.a.subtype === 'city' || d.a.subtype === 'town' ? 12.5 : 11),
          getColor: [29, 29, 31, 255],
          getPixelOffset: [0, -13],
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
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
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, data, exposure, setup, terrain, terrainMode, image, observedImage, particles, impacts, view, selectedAsset, assetZ]);

  // ---- Hover: read the rasters under the cursor --------------------------------------------
  const onHover = useCallback(
    (info: PickingInfo) => {
      if (!data || !info.coordinate) {
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
        setHover({ x: info.x, y: info.y, title: a.name, lines });
        return;
      }
      const [lng, lat] = info.coordinate;
      const cell = lngLatToCell(data.grid, lng, lat);
      if (!cell) {
        setHover(null);
        return;
      }
      const r = results.get(primary);
      const loc = results.locate(primary, useSimStore.getState().playhead);
      const ground = sampleBilinear(data.dem, data.grid.cols, data.grid.rows, lng === undefined ? 0 : ((lng - data.grid.bbox[0]) / data.grid.lngStep), (data.grid.bbox[3] - lat) / data.grid.latStep);
      const lines: string[] = [`Ground ${Math.round(ground)} m`];
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
    [data, exposure, impacts, primary],
  );

  const onClick = useCallback(
    (info: PickingInfo) => {
      if (useUiStore.getState().pickingDam && info.coordinate) {
        window.dispatchEvent(new CustomEvent('cascade:pick', { detail: { lng: info.coordinate[0], lat: info.coordinate[1] } }));
        useUiStore.getState().setPickingDam(false);
        return;
      }
      if (info.layer?.id === 'assets' && info.index >= 0) useSimStore.getState().selectAsset(info.index);
    },
    [],
  );

  return (
    <div className="absolute inset-0">
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: v }) => setViewState(v as MapViewState)}
        controller={{ inertia: 250, scrollZoom: { smooth: true, speed: 0.02 } }}
        layers={layers as never}
        onHover={onHover}
        onClick={onClick}
        pickingRadius={6}
        getCursor={({ isDragging, isHovering }) => (pickingDam ? 'crosshair' : isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab')}
      >
        <MapGL reuseMaps mapStyle={view.basemap === 'satellite' ? (SATELLITE_STYLE as never) : LIGHT_STYLE} attributionControl={{ compact: true }} />
      </DeckGL>
      {hover && (
        <div
          className="glass-strong pointer-events-none absolute z-30 max-w-[260px] rounded-xl px-3 py-2 text-[12px] shadow-float"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
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
