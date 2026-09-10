import { stepSolver } from './solver';

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
    
    stepCounter++;
    const { waterDepth, arrivalTime: newArrival } = stepSolver(
      gridSize, elevation, arrivalTime,
      msg.payload.waterDepth, msg.payload.breachPoint, msg.payload.releaseRate,
      msg.payload.friction, msg.payload.timeStep, stepCounter
    );
    arrivalTime = newArrival; // keep ref

    (postMessage as any)({ 
      type: 'STEP_RESULT', 
      payload: { waterDepth: waterDepth, arrivalTime: newArrival } 
    }, [waterDepth.buffer, newArrival.buffer]);
  }
};
