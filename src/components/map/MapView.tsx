"use client";

import React, { useState, useCallback, useMemo } from 'react';
import Map, { NavigationControl, Marker } from 'react-map-gl/maplibre';
import DeckGL from '@deck.gl/react';
import { GridCellLayer, ScatterplotLayer } from '@deck.gl/layers';
import { TerrainLayer } from '@deck.gl/geo-layers';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useScenarioStore } from '@/store/scenarioStore';
import { useSimulationStore } from '@/store/simulationStore';
import { ShieldAlert } from 'lucide-react';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const TERRAIN_IMAGE = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`;

export default function MapView() {
  const { activeScenario, basemap } = useScenarioStore();
  const { waterDepth, arrivalTime, currentStep } = useSimulationStore();

  const [viewState, setViewState] = useState({
    longitude: 78.476,
    latitude: 30.383,
    zoom: 11,
    pitch: 60,
    bearing: 0
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
      }));
    }
  }, [activeScenario]);



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
    new TerrainLayer({
      id: 'terrain',
      minZoom: 0,
      maxZoom: 23,
      strategy: 'no-overlap',
      elevationDecoder: {
        rScaler: 256,
        gScaler: 1,
        bScaler: 1 / 256,
        offset: -32768
      },
      elevationData: TERRAIN_IMAGE,
      texture: basemap === 'satellite' 
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' 
        : MAP_STYLE,
      wireframe: false,
      color: [255, 255, 255]
    }),
    new GridCellLayer({
      id: 'water-grid',
      data: gridData,
      pickable: true,
      extruded: true,
      cellSize: activeScenario?.cellSize || 30,
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
    })
  ].filter(Boolean);

  return (
    <div className="absolute inset-0 w-full h-full bg-[#0f172a]">
      <DeckGL
        layers={layers}
        viewState={viewState}
        onViewStateChange={onViewStateChange}
        controller={true}
      >
        {activeScenario && (
          <Map 
            mapStyle={MAP_STYLE} 
            reuseMaps 
          >
            <Marker longitude={activeScenario.center[0]} latitude={activeScenario.center[1]}>
              <div className="text-red-500 animate-bounce flex flex-col items-center">
                <ShieldAlert className="w-8 h-8 fill-black" />
                <span className="text-xs font-bold bg-black px-1 mt-1 rounded">{activeScenario.name}</span>
              </div>
            </Marker>
            <NavigationControl position="bottom-right" />
          </Map>
        )}
      </DeckGL>
    </div>
  );
}
