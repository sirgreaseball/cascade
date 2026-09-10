"use client";

import React, { useState, useCallback, useMemo } from 'react';
import Map, { NavigationControl, Marker } from 'react-map-gl/maplibre';
import DeckGL from '@deck.gl/react';
import { LightingEffect, AmbientLight, _SunLight as SunLight } from '@deck.gl/core';
import { GridCellLayer, ScatterplotLayer, GeoJsonLayer } from '@deck.gl/layers';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useScenarioStore } from '@/store/scenarioStore';
import { useSimulationStore } from '@/store/simulationStore';
import { ShieldAlert } from 'lucide-react';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const TERRAIN_IMAGE = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`;

const ambientLight = new AmbientLight({ color: [255, 255, 255], intensity: 1.0 });
const sunLight = new SunLight({ timestamp: 1564696800000, color: [255, 255, 255], intensity: 2.0 });
const lightingEffect = new LightingEffect({ ambientLight, sunLight });

export default function MapView() {
  const { activeScenario, basemap, observedData } = useScenarioStore();
  const { waterDepth, arrivalTime, currentStep } = useSimulationStore();

  const [viewState, setViewState] = useState({
    longitude: 78.476,
    latitude: 30.383,
    zoom: 11,
    pitch: 55,
    bearing: -20
  });

  const onViewStateChange = useCallback(({ viewState }: any) => {
    setViewState(viewState);
  }, []);

  React.useEffect(() => {
    if (activeScenario) {
      setViewState(prev => ({
        ...prev,
        longitude: activeScenario.center[0],
        latitude: activeScenario.center[1],
        pitch: 55,
        bearing: -20
      }));
    }
  }, [activeScenario]);

  const [satelliteError, setSatelliteError] = useState(false);


  const computedCellSize = useMemo(() => {
    if (!activeScenario) return 30;
    const { bbox, gridSize } = activeScenario;
    const meanLat = (bbox[1] + bbox[3]) / 2;
    const lonSpanM = (bbox[2] - bbox[0]) * 111320 * Math.cos(meanLat * (Math.PI / 180));
    const latSpanM = (bbox[3] - bbox[1]) * 110540;
    const cellW = lonSpanM / gridSize;
    const cellH = latSpanM / gridSize;
    const size = Math.max(cellW, cellH) * 1.05;
    console.log(`TERRAIN CELL: ${size.toFixed(2)}m`);
    return size;
  }, [activeScenario]);

  const elevationGridData = useMemo(() => {
    const { elevation } = useSimulationStore.getState();
    if (!activeScenario || !elevation) return [];
    
    const { gridSize, bbox } = activeScenario;
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const data = [];

    const lngStep = (maxLng - minLng) / gridSize;
    const latStep = (maxLat - minLat) / gridSize;

    const step = gridSize > 256 ? 4 : 2;

    for (let y = 0; y < gridSize; y += step) {
      for (let x = 0; x < gridSize; x += step) {
        const idx = y * gridSize + x;
        const e = elevation[idx];
        if (e > 0) {
          data.push({
            position: [minLng + (x * lngStep), maxLat - (y * latStep)],
            elevation: e
          });
        }
      }
    }
    return data;
  }, [activeScenario, useSimulationStore.getState().elevation]);

  const gridData = useMemo(() => {
    if (!activeScenario || !waterDepth || !arrivalTime) return [];
    
    const { gridSize, cellSize, bbox } = activeScenario;
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const data = [];

    const lngStep = (maxLng - minLng) / gridSize;
    const latStep = (maxLat - minLat) / gridSize;

    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const idx = y * gridSize + x;
        const depth = waterDepth[idx];
        const arrival = arrivalTime[idx];
        if (depth > 0.1) {
          data.push({
            position: [minLng + (x * lngStep), maxLat - (y * latStep)],
            depth,
            arrival
          });
        }
      }
    }
    return data;
  }, [activeScenario, waterDepth, arrivalTime]);

  const comparisonData = useMemo(() => {
    const { comparisonWaterDepth } = useSimulationStore.getState();
    if (!activeScenario || !comparisonWaterDepth) return [];
    
    const { gridSize, bbox } = activeScenario;
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const data = [];

    const lngStep = (maxLng - minLng) / gridSize;
    const latStep = (maxLat - minLat) / gridSize;

    // Subsample for SPH style rendering
    for (let y = 0; y < gridSize; y += 2) {
      for (let x = 0; x < gridSize; x += 2) {
        const idx = y * gridSize + x;
        const depth = comparisonWaterDepth[idx];
        if (depth > 0.1) {
          data.push({
            position: [minLng + (x * lngStep), maxLat - (y * latStep)],
            depth
          });
        }
      }
    }
    return data;
  }, [activeScenario, useSimulationStore.getState().comparisonWaterDepth]);

  const layers = [

    new GridCellLayer({
      id: 'fallback-terrain-layer',
      data: elevationGridData,
      pickable: false,
      extruded: true,
      cellSize: computedCellSize,
      elevationScale: 4,
      getPosition: (d: any) => d.position,
      getElevation: (d: any) => d.elevation,
      opacity: 1,
      getFillColor: (d: any) => {
        // Deep slate valleys to lighter ridge tops
        const e = d.elevation;
        if (e < 500) return [30, 41, 59]; // slate-800 (#1e293b)
        if (e < 800) return [51, 65, 85]; // slate-700
        if (e < 1200) return [71, 85, 105]; // slate-600
        if (e < 1600) return [100, 116, 139]; // slate-500
        if (e < 2000) return [148, 163, 184]; // slate-400 (#94a3b8)
        return [203, 213, 225]; // slate-300
      },
    }),
    new GridCellLayer({
      id: 'water-grid',
      data: gridData,
      pickable: true,
      extruded: true,
      cellSize: computedCellSize,
      elevationScale: 4,
      getPosition: (d: any) => d.position,
      getElevation: (d: any) => d.depth,
      getFillColor: (d: any) => {
        // Active flood front (arrived within last 2 steps)
        if (currentStep - d.arrival < 2) {
          return [245, 158, 11, 255]; // Amber highlight
        }
        // Shallow vs Deep
        return d.depth < 2 
          ? [56, 189, 248, 150] // Translucent light blue
          : [2, 132, 199, 200]; // Darker blue
      },
    }),
    comparisonData.length > 0 && new ScatterplotLayer({
      id: 'comparison-sph-layer',
      data: comparisonData,
      pickable: false,
      opacity: 0.8,
      stroked: false,
      filled: true,
      radiusScale: activeScenario?.cellSize || 30,
      radiusMinPixels: 2,
      radiusMaxPixels: 10,
      getPosition: (d: any) => d.position,
      getFillColor: [249, 115, 22, 180], // Orange
    }),
    observedData && new GeoJsonLayer({
      id: 'observed-nrt-layer',
      data: observedData,
      pickable: false,
      stroked: true,
      filled: true,
      extruded: false,
      getFillColor: [14, 165, 233, 100], // Sky blue translucent
      getLineColor: [2, 132, 199, 255],
      lineWidthMinPixels: 2,
    })
  ].filter(Boolean);

  return (
    <div className="absolute inset-0 w-full h-full bg-[#020617]">
      <DeckGL
        effects={[lightingEffect]}
        layers={layers}
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        controller={true}
      >
        {activeScenario && (
          <Map 
            mapStyle={basemap === 'satellite' ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' : MAP_STYLE}
            reuseMaps 
            onError={(e: any) => {
              if (basemap === 'satellite') {
                useScenarioStore.getState().setBasemap('dark');
                setSatelliteError(true);
                setTimeout(() => setSatelliteError(false), 5000);
              }
            }}
          >
            <Marker longitude={activeScenario.center[0]} latitude={activeScenario.center[1]}>
              <div className="text-red-500 animate-bounce flex flex-col items-center">
                <ShieldAlert className="w-8 h-8 fill-black" />
                <span className="text-xs font-bold bg-black px-1 mt-1 rounded">{activeScenario.name}</span>
              </div>
            </Marker>
            
          </Map>
        )}
      </DeckGL>

      {satelliteError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-900/90 border border-red-500 text-red-200 px-4 py-2 rounded shadow-2xl font-mono text-sm tracking-widest backdrop-blur-sm animate-pulse">
          SATELLITE FEED UNAVAILABLE - TERRAIN MODE
        </div>
      )}

    </div>
  );
}
