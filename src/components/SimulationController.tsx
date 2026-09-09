"use client";

import React, { useEffect, useRef } from 'react';
import { useSimulationStore } from '@/store/simulationStore';
import { useScenarioStore } from '@/store/scenarioStore';

export default function SimulationController() {
  const { activeScenario } = useScenarioStore();
  const { status, currentStep, breachWidth, releaseRate, simulationSpeed, updateSimulationOutput } = useSimulationStore();
  
  const workerRef = useRef<Worker | null>(null);
  const elevationRef = useRef<Float32Array | null>(null);
  const waterDepthRef = useRef<Float32Array | null>(null);

  // Initialize Worker and Elevation Data
  useEffect(() => {
    if (!activeScenario) return;

    // Create worker
    workerRef.current = new Worker(new URL('../../simulation/floodWorker.ts', import.meta.url));

    // For demo, generate mock elevation (cone pointing down)
    const gridSize = activeScenario.gridSize;
    const elevation = new Float32Array(gridSize * gridSize);
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const cx = gridSize / 2;
        const cy = gridSize / 2;
        const dist = Math.sqrt(Math.pow(x - cx, 2) + Math.pow(y - cy, 2));
        elevation[y * gridSize + x] = dist * 0.5; // Slope
      }
    }
    elevationRef.current = elevation;
    waterDepthRef.current = new Float32Array(gridSize * gridSize); // Initial empty water

    workerRef.current.postMessage({
      type: 'INIT',
      payload: { gridSize, elevation }
    });

    workerRef.current.onmessage = (e) => {
      if (e.data.type === 'STEP_RESULT') {
        const { waterDepth, arrivalTime } = e.data.payload;
        waterDepthRef.current = waterDepth;
        updateSimulationOutput(currentStep + 1, waterDepth, arrivalTime);
      }
    };

    return () => {
      workerRef.current?.terminate();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScenario]);

  // Simulation Loop
  useEffect(() => {
    let animationFrameId: number;
    let lastUpdate = performance.now();

    const loop = (time: number) => {
      if (status === 'running' && workerRef.current && activeScenario && waterDepthRef.current) {
        // Throttle updates based on simulation speed
        if (time - lastUpdate > (100 / simulationSpeed)) {
          workerRef.current.postMessage({
            type: 'STEP',
            payload: {
              waterDepth: waterDepthRef.current,
              breachPoint: activeScenario.breachPoint,
              breachWidth,
              releaseRate: releaseRate / 100, // scaled for step
              friction: activeScenario.simulation.friction,
              timeStep: activeScenario.simulation.timeStep
            }
          }, [waterDepthRef.current.buffer]); // Transfer zero-copy
          
          lastUpdate = time;
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
