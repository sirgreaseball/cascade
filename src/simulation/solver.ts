export function stepSolver(
  gridSize: number,
  elevation: Float32Array,
  arrivalTime: Float32Array,
  waterDepth: Float32Array,
  breachPoint: { x: number, y: number },
  releaseRate: number,
  friction: number,
  timeStep: number,
  stepCounter: number
): { waterDepth: Float32Array; arrivalTime: Float32Array } {
  const nextWaterDepth = new Float32Array(waterDepth);
  
  const bIdx = breachPoint.y * gridSize + breachPoint.x;
  nextWaterDepth[bIdx] += releaseRate;
  if (arrivalTime[bIdx] === -1) arrivalTime[bIdx] = stepCounter;

  for (let y = 1; y < gridSize - 1; y++) {
    for (let x = 1; x < gridSize - 1; x++) {
      const idx = y * gridSize + x;
      const currentWater = waterDepth[idx];
      
      if (currentWater <= 0.01) continue;

      const currentSurface = elevation[idx] + currentWater;
      
      const neighbors = [
        idx - gridSize,
        idx + gridSize,
        idx - 1,
        idx + 1
      ];

      let totalOutflow = 0;

      for (const nIdx of neighbors) {
        const neighborSurface = elevation[nIdx] + waterDepth[nIdx];
        const diff = currentSurface - neighborSurface;
        
        if (diff > 0) {
          const flow = Math.min(diff * (1 - friction) * timeStep, currentWater / 4);
          if (flow > 0.001) {
            nextWaterDepth[nIdx] += flow;
            totalOutflow += flow;
            
            if (arrivalTime[nIdx] === -1) {
              arrivalTime[nIdx] = stepCounter;
            }
          }
        }
      }
      
      nextWaterDepth[idx] -= totalOutflow;
      if (nextWaterDepth[idx] < 0) nextWaterDepth[idx] = 0;
    }
  }

  return { waterDepth: nextWaterDepth, arrivalTime: new Float32Array(arrivalTime) };
}
