// Web Worker for Cellular Automata Flood Simulation

type SimMessage = 
  | { type: 'INIT'; payload: { gridSize: number; elevation: Float32Array } }
  | { type: 'STEP'; payload: { 
      waterDepth: Float32Array; 
      breachPoint: { x: number, y: number };
      breachWidth: number;
      releaseRate: number;
      friction: number;
      timeStep: number;
    } };

let elevation: Float32Array | null = null;
let gridSize = 256;

self.onmessage = (e: MessageEvent<SimMessage>) => {
  const msg = e.data;

  if (msg.type === 'INIT') {
    elevation = msg.payload.elevation;
    gridSize = msg.payload.gridSize;
    self.postMessage({ type: 'READY' });
  } 
  
  else if (msg.type === 'STEP') {
    if (!elevation) return;

    const { waterDepth, breachPoint, releaseRate, friction, timeStep } = msg.payload;
    const nextWaterDepth = new Float32Array(waterDepth); // copy current state
    const arrivalTime = new Float32Array(gridSize * gridSize); // Simplified for demo, ideally we track this persistently

    // Inject water at breach
    const breachIdx = breachPoint.y * gridSize + breachPoint.x;
    nextWaterDepth[breachIdx] += releaseRate * timeStep;

    // Simple 4-neighbor Cellular Automata Flow
    for (let y = 1; y < gridSize - 1; y++) {
      for (let x = 1; x < gridSize - 1; x++) {
        const idx = y * gridSize + x;
        const currentWater = waterDepth[idx];
        
        if (currentWater <= 0) continue;

        const currentSurface = elevation[idx] + currentWater;
        let totalOutflow = 0;
        
        const neighbors = [
          idx - gridSize, // North
          idx + gridSize, // South
          idx - 1,        // West
          idx + 1         // East
        ];

        // Calculate differences
        const flows = neighbors.map(nIdx => {
          const neighborSurface = (elevation as Float32Array)[nIdx] + waterDepth[nIdx];
          const diff = currentSurface - neighborSurface;
          if (diff > 0) {
            // Flow is proportional to difference and friction
            const flow = Math.min(diff * (1 - friction) * timeStep, currentWater / 4);
            return flow;
          }
          return 0;
        });

        // Apply flows
        flows.forEach((flow, i) => {
          if (flow > 0) {
            const nIdx = neighbors[i];
            nextWaterDepth[nIdx] += flow;
            totalOutflow += flow;
          }
        });

        nextWaterDepth[idx] -= totalOutflow;
      }
    }

    // Transfer back via zero-copy
    (postMessage as any)({ 
      type: 'STEP_RESULT', 
      payload: { waterDepth: nextWaterDepth, arrivalTime } 
    }, [nextWaterDepth.buffer, arrivalTime.buffer]);
  }
};
