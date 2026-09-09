"use client";

import React, { useState, useCallback, useMemo } from 'react';
import Map, { NavigationControl } from 'react-map-gl/maplibre';
import DeckGL from '@deck.gl/react';
import { GridCellLayer } from '@deck.gl/layers';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useScenarioStore } from '@/store/scenarioStore';
import { useSimulationStore } from '@/store/simulationStore';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

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

  // When active scenario changes, snap map to center
  React.useEffect(() => {
    if (activeScenario) {
      setViewState(prev => ({
        ...prev,
        longitude: activeScenario.center[0],
        latitude: activeScenario.center[1],
      }));
    }
  }, [activeScenario]);

  // Construct GridCellLayer data from TypedArray
  const gridData = useMemo(() => {
    if (!activeScenario || !waterDepth) return [];
    
    const { gridSize, cellSize, center, bbox } = activeScenario;
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const data = [];

    // Simple projection approximation for demo purposes
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
    new GridCellLayer({
      id: 'water-grid',
      data: gridData,
      pickable: true,
      extruded: true,
      cellSize: activeScenario?.cellSize || 30,
      elevationScale: 4,
      getPosition: (d: any) => d.position,
      getElevation: (d: any) => d.depth,
      getFillColor: (d: any) => [59, 130, 246, Math.min(255, 100 + d.depth * 10)], // Tailwind blue-500
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
        <Map 
          mapStyle={MAP_STYLE} 
          reuseMaps 
        >
          <NavigationControl position="bottom-right" />
        </Map>
      </DeckGL>
    </div>
  );
}
