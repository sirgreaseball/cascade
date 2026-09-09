// MOCK Web Worker for Flood Simulation

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
let stepCounter = 0;

self.onmessage = (e: MessageEvent<SimMessage>) => {
  const msg = e.data;

  if (msg.type === 'INIT') {
    gridSize = msg.payload.gridSize;
    stepCounter = 0;
    self.postMessage({ type: 'READY' });
  } 
  
  else if (msg.type === 'STEP') {
    const { waterDepth, breachPoint, releaseRate } = msg.payload;
    const nextWaterDepth = new Float32Array(waterDepth);
    const arrivalTime = new Float32Array(gridSize * gridSize); 
    
    stepCounter++;

    // Mock behavior: expand a circle from breach point
    const radius = stepCounter * (releaseRate / 10000); 

    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const dx = x - breachPoint.x;
        const dy = y - breachPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        const idx = y * gridSize + x;

        if (dist <= radius) {
          // Inner circle = deep water
          nextWaterDepth[idx] = 10 - (dist / radius) * 5;
          arrivalTime[idx] = stepCounter - Math.floor(dist); // arbitrary mock arrival time
        }
      }
    }

    // Transfer back via zero-copy
    (postMessage as any)({ 
      type: 'STEP_RESULT', 
      payload: { waterDepth: nextWaterDepth, arrivalTime } 
    }, [nextWaterDepth.buffer, arrivalTime.buffer]);
  }
};
