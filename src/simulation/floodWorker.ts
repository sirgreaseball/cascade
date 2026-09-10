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

let gridSize = 256;
let elevation: Float32Array | null = null;
let arrivalTime: Float32Array | null = null;
let stepCounter = 0;

self.onmessage = (e: MessageEvent<SimMessage>) => {
  const msg = e.data;

  if (msg.type === 'INIT') {
    gridSize = msg.payload.gridSize;
    elevation = msg.payload.elevation;
    arrivalTime = new Float32Array(gridSize * gridSize);
    arrivalTime.fill(-1);
    stepCounter = 0;
    self.postMessage({ type: 'READY' });
  } 
  
  else if (msg.type === 'STEP') {
    if (!elevation || !arrivalTime) return;
    
    const { waterDepth, breachPoint, releaseRate, friction, timeStep } = msg.payload;
    const nextWaterDepth = new Float32Array(waterDepth);
    
    stepCounter++;

    // Inject water at breach point
    const bIdx = breachPoint.y * gridSize + breachPoint.x;
    nextWaterDepth[bIdx] += releaseRate;
    if (arrivalTime[bIdx] === -1) arrivalTime[bIdx] = stepCounter;

    // Cellular Automata
    for (let y = 1; y < gridSize - 1; y++) {
      for (let x = 1; x < gridSize - 1; x++) {
        const idx = y * gridSize + x;
        const currentWater = waterDepth[idx];
        
        if (currentWater <= 0.01) continue;

        const currentSurface = elevation[idx] + currentWater;
        
        const neighbors = [
          idx - gridSize, // North
          idx + gridSize, // South
          idx - 1,        // West
          idx + 1         // East
        ];

        let totalOutflow = 0;

        for (const nIdx of neighbors) {
          const neighborSurface = elevation[nIdx] + waterDepth[nIdx];
          const diff = currentSurface - neighborSurface;
          
          if (diff > 0) {
            // Transfer water proportional to height difference, clamped by friction and max available
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
        // Clamp to 0
        if (nextWaterDepth[idx] < 0) nextWaterDepth[idx] = 0;
      }
    }

    const arrivalTimeClone = new Float32Array(arrivalTime);

    // Transfer back via zero-copy
    (postMessage as any)({ 
      type: 'STEP_RESULT', 
      payload: { waterDepth: nextWaterDepth, arrivalTime: arrivalTimeClone } 
    }, [nextWaterDepth.buffer, arrivalTimeClone.buffer]);
  }
};
