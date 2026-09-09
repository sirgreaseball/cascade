"use client";

import React, { useState, useCallback, useMemo } from 'react';
import Map, { NavigationControl, Marker } from 'react-map-gl/maplibre';
import DeckGL from '@deck.gl/react';
import { GridCellLayer } from '@deck.gl/layers';
import { TerrainLayer } from '@deck.gl/geo-layers';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useScenarioStore } from '@/store/scenarioStore';
import { useSimulationStore } from '@/store/simulationStore';
import { ShieldAlert } from 'lucide-react';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const TERRAIN_IMAGE = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`;

export default function MapView() {
  const { activeScenario } = useScenarioStore();
  const { waterDepth } = useSimulationStore();

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
    if (!activeScenario || !waterDepth) return [];
    
    const { gridSize, cellSize, bbox } = activeScenario;
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const data = [];

    const lngStep = (maxLng - minLng) / gridSize;
    const latStep = (maxLat - minLat) / gridSize;

    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const depth = waterDepth[y * gridSize + x];
        if (depth > 0.1) {
          data.push({
            position: [minLng + (x * lngStep), maxLat - (y * latStep)],
            depth
          });
        }
      }
    }
    return data;
  }, [activeScenario, waterDepth]);

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
      texture: MAP_STYLE, // Use the map style as texture on the 3D terrain
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
      getFillColor: (d: any) => [59, 130, 246, Math.min(255, 100 + d.depth * 10)], 
    })
  ];

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
