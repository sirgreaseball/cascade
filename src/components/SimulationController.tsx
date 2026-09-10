"use client";

import React, { useEffect, useRef } from 'react';
import { useSimulationStore } from '@/store/simulationStore';
import { useScenarioStore } from '@/store/scenarioStore';

import { runAnalytics } from '@/lib/analytics';

import { CASolverAdapter } from '@/simulation/adapters';
import { SolverAdapter } from '@/simulation/SolverAdapter';

export default function SimulationController() {
  const { activeScenario, infrastructureData, evacuationData } = useScenarioStore();
  const { status, currentStep, breachWidth, releaseRate, simulationSpeed, updateSimulationOutput, updateImpacts } = useSimulationStore();
  
  const solverRef = useRef<SolverAdapter | null>(null);
  const elevationRef = useRef<Float32Array | null>(null);
  const waterDepthRef = useRef<Float32Array | null>(null);
  const isSteppingRef = useRef(false);
  
  // Analytics state
  const previouslyFloodedIds = useRef<Set<string>>(new Set());
  const stepsSinceAnalytics = useRef(0);

  // Initialize Worker and Elevation Data
  useEffect(() => {
    if (!activeScenario) return;

    // Reset analytics state on scenario change
    previouslyFloodedIds.current.clear();
    stepsSinceAnalytics.current = 0;

    // Initialize solver and data asynchronously
    const initData = async () => {
      solverRef.current = new CASolverAdapter();

      const gridSize = activeScenario.gridSize;
      const elevationFile = activeScenario.demUrl || `/data/${activeScenario.id}/elevation.bin`;
      let elevation: Float32Array;

      try {
        const res = await fetch(elevationFile);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuffer = await res.arrayBuffer();
        elevation = new Float32Array(arrayBuffer);
        
        if (elevation.length !== gridSize * gridSize) {
          throw new Error(`Size mismatch: got ${elevation.length}, expected ${gridSize * gridSize}`);
        }
        console.log(`Loaded DEM binary: ${elevationFile}`);
      } catch (err) {
        console.warn(`Failed to load real DEM (${elevationFile}), falling back to synthetic V-valley. Error: ${err}`);
        
        // Fallback: Generate V-shaped valley and two ridges
        elevation = new Float32Array(gridSize * gridSize);
        for (let y = 0; y < gridSize; y++) {
          for (let x = 0; x < gridSize; x++) {
            const nx = (x / gridSize) * 2 - 1;
            const ny = (y / gridSize) * 2 - 1;
            const valley = Math.abs(nx) * 100;
            const slope = -ny * 50;
            elevation[y * gridSize + x] = valley + slope; 
          }
        }
      }

      elevationRef.current = elevation;
      waterDepthRef.current = new Float32Array(gridSize * gridSize); // Initial empty water

      await solverRef.current.init(gridSize, elevation);
    };

    initData();

    return () => {
      solverRef.current?.terminate();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScenario]);

  // Simulation Loop
  useEffect(() => {
    let animationFrameId: number;
    let lastUpdate = performance.now();

    const loop = async (time: number) => {
      if (status === 'running' && solverRef.current && activeScenario && waterDepthRef.current && !isSteppingRef.current) {
        // Throttle updates based on simulation speed
        if (time - lastUpdate > (100 / simulationSpeed)) {
          isSteppingRef.current = true;
          lastUpdate = time;

          try {
            const result = await solverRef.current.step(
              waterDepthRef.current,
              activeScenario.breachPoint,
              breachWidth,
              releaseRate / 100, // scaled for step
              activeScenario.simulation.friction,
              activeScenario.simulation.timeStep
            );

            waterDepthRef.current = result.waterDepth;
            updateSimulationOutput(currentStep + 1, result.waterDepth, result.arrivalTime);

            // Run analytics every 10 steps
            stepsSinceAnalytics.current++;
            if (stepsSinceAnalytics.current >= 10) {
              stepsSinceAnalytics.current = 0;
              const { impacts, newAlerts, newlyFloodedIds } = runAnalytics(
                result.waterDepth,
                activeScenario.gridSize,
                activeScenario.bbox,
                infrastructureData,
                evacuationData,
                previouslyFloodedIds.current,
                currentStep + 1
              );

              newlyFloodedIds.forEach(id => previouslyFloodedIds.current.add(id));
              updateImpacts(impacts, newAlerts, newlyFloodedIds);
            }
          } finally {
            isSteppingRef.current = false;
          }
        }
      }
      animationFrameId = requestAnimationFrame(loop);
    };

    if (status === 'running') {
      animationFrameId = requestAnimationFrame(loop);
    }

    return () => cancelAnimationFrame(animationFrameId);
  }, [status, activeScenario, breachWidth, releaseRate, simulationSpeed, currentStep]);

  return null; // Logic-only component
}
