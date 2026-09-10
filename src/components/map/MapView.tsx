'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DeckGL from '@deck.gl/react';
import MapGL from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { COORDINATE_SYSTEM, FlyToInterpolator } from '@deck.gl/core';
import type { MapViewState, PickingInfo } from '@deck.gl/core';
import { BitmapLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { TerrainLayer } from '@deck.gl/geo-layers';
import { _TerrainExtension as TerrainExtension, CollisionFilterExtension } from '@deck.gl/extensions';
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
const terrainExt = new TerrainExtension();
const collisionExt = new CollisionFilterExtension();

interface Hover {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

function useTerrainTextures() {
  const config = useScenarioStore((s) => s.config);
  const data = useScenarioStore((s) => s.data);
  const [tex, setTex] = useState<{ id: string; elevation: string; texture: string; satellite: boolean } | null>(null);
  useEffect(() => {
    if (!config || !data) return;
    let cancelled = false;
    const elevation = terrariumDataUrl(data.dem, data.grid.cols, data.grid.rows);
    const shade = hillshadeDataUrl(data.dem, data.grid);
    setTex({ id: config.id, elevation, texture: shade, satellite: false });
    satelliteDataUrl(data.grid.bbox).then((sat) => {
      if (!cancelled && sat) setTex({ id: config.id, elevation, texture: sat, satellite: true });
    });
    return () => {
      cancelled = true;
    };
  }, [config, data]);
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
  const playhead = useSimStore((s) => s.playhead);
  const version = useSimStore((s) => s.resultsVersion);
  const selectedAsset = useSimStore((s) => s.selectedAsset);
  const pickingDam = useUiStore((s) => s.pickingDam);
  const primary = usePrimaryEngine();
  const impacts = useImpacts(primary);
  const terrain = useTerrainTextures();

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
  const buffers = useRef<{ a: Uint8ClampedArray; b: Uint8ClampedArray; flip: boolean; n: number } | null>(null);
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

    if (view.terrain3d && terrain && terrain.id === config.id) {
      list.push(
        new TerrainLayer({
          id: `terrain-${config.id}`,
          elevationData: terrain.elevation,
          texture: terrain.texture,
          bounds: bbox,
          elevationDecoder: TERRARIUM_DECODER,
          meshMaxError: 4,
          operation: 'terrain+draw',
          loadOptions: { worker: false },
          material: { ambient: 0.62, diffuse: 0.55, shininess: 8, specularColor: [30, 30, 30] },
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
      const radius = (d: { population: number; kind: string }) => (d.kind === 'settlement' ? 2.6 + 1.5 * Math.log10(Math.max(d.population, 100) / 100) : 3.2);
      list.push(
        new ScatterplotLayer({
          id: 'assets',
          data: exposure.assets,
          pickable: true,
          getPosition: (d: { lng: number; lat: number }) => [d.lng, d.lat],
          getRadius: radius,
          radiusUnits: 'pixels',
          stroked: true,
          lineWidthUnits: 'pixels',
          getLineWidth: (_d: unknown, { index }: { index: number }) => (index === selectedAsset ? 3 : 1.25),
          getFillColor: (d: { kind: string }, { index }: { index: number }) => {
            const s = statuses?.[index];
            if (s && s.hazard > 0) return [...hazardRgb[s.hazard - 1], 255] as [number, number, number, number];
            return d.kind === 'settlement' ? [255, 255, 255, 235] : [29, 29, 31, 210];
          },
          getLineColor: (_d: unknown, { index }: { index: number }) => (index === selectedAsset ? [0, 113, 227, 255] : [29, 29, 31, 170]),
          extensions: view.terrain3d ? [terrainExt] : [],
          updateTriggers: { getFillColor: [statuses], getLineColor: [selectedAsset], getLineWidth: [selectedAsset] },
        }),
      );
      const labelled = exposure.assets
        .map((a, index) => ({ a, index }))
        .filter(({ a, index }) => a.kind === 'settlement' && (a.subtype === 'city' || a.subtype === 'town' || (statuses?.[index]?.hazard ?? 0) > 0 || index === selectedAsset));
      list.push(
        new TextLayer({
          id: 'labels',
          data: labelled,
          getPosition: (d: { a: { lng: number; lat: number } }) => [d.a.lng, d.a.lat],
          getText: (d: { a: { name: string } }) => d.a.name,
          getSize: (d: { a: { subtype: string } }) => (d.a.subtype === 'city' || d.a.subtype === 'town' ? 13 : 11),
          getColor: [29, 29, 31, 255],
          getPixelOffset: [0, -14],
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
          fontWeight: 600,
          fontSettings: { sdf: true, buffer: 6 },
          outlineWidth: 5,
          outlineColor: [255, 255, 255, 235],
          characterSet: 'auto',
          getCollisionPriority: (d: { a: { population: number } }) => Math.log10(d.a.population + 1),
          collisionGroup: 'labels',
          extensions: view.terrain3d ? [terrainExt, collisionExt] : [collisionExt],
          updateTriggers: { getPosition: [view.terrain3d] },
        }),
      );
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, data, exposure, setup, terrain, image, observedImage, particles, impacts, view, selectedAsset]);

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
