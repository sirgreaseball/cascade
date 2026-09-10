import { SolverAdapter } from './SolverAdapter';
import { stepSolver } from './solver';

export class CASolverAdapter implements SolverAdapter {
  private worker: Worker | null = null;
  private isFallback = false;
  private elevation: Float32Array | null = null;
  private arrivalTime: Float32Array | null = null;
  private stepCounter = 0;
  private gridSize = 0;

  async init(gridSize: number, elevation: Float32Array): Promise<void> {
    this.gridSize = gridSize;
    this.elevation = elevation;
    this.arrivalTime = new Float32Array(gridSize * gridSize).fill(-1);
    this.stepCounter = 0;

    return new Promise((resolve) => {
      try {
        this.worker = new Worker(new URL('./floodWorker.ts', import.meta.url), { type: 'module' });
        
        const timeout = setTimeout(() => {
          console.warn("Worker init timed out. Falling back to main thread solver.");
          console.log("SOLVER MODE: main-thread-fallback");
          this.isFallback = true;
          this.worker?.terminate();
          this.worker = null;
          resolve();
        }, 3000);

        const onReady = (e: MessageEvent) => {
          if (e.data.type === 'READY') {
            clearTimeout(timeout);
            this.worker?.removeEventListener('message', onReady);
            console.log("SOLVER MODE: worker");
            resolve();
          }
        };
        
        this.worker.addEventListener('message', onReady);
        this.worker.addEventListener('error', (e) => {
          clearTimeout(timeout);
          console.warn("Worker error. Falling back to main thread solver.", e);
          console.log("SOLVER MODE: main-thread-fallback");
          this.isFallback = true;
          this.worker?.terminate();
          this.worker = null;
          resolve();
        });

        this.worker.postMessage({
          type: 'INIT',
          payload: { gridSize, elevation }
        });
      } catch (err) {
        console.warn("Worker creation failed. Falling back to main thread solver.", err);
        console.log("SOLVER MODE: main-thread-fallback");
        this.isFallback = true;
        resolve();
      }
    });
  }

  async step(
    waterDepth: Float32Array,
    breachPoint: { x: number; y: number },
    breachWidth: number,
    releaseRate: number,
    friction: number,
    timeStep: number
  ): Promise<{ waterDepth: Float32Array; arrivalTime: Float32Array }> {
    if (this.isFallback) {
      this.stepCounter++;
      const result = stepSolver(
        this.gridSize, this.elevation!, this.arrivalTime!, waterDepth,
        breachPoint, releaseRate, friction, timeStep, this.stepCounter
      );
      this.arrivalTime = result.arrivalTime;
      return Promise.resolve(result);
    }

    return new Promise((resolve) => {
      if (!this.worker) throw new Error("Worker not initialized");

      const onStep = (e: MessageEvent) => {
        if (e.data.type === 'STEP_RESULT') {
          this.worker?.removeEventListener('message', onStep);
          resolve(e.data.payload);
        }
      };
      this.worker.addEventListener('message', onStep);

      this.worker.postMessage({
        type: 'STEP',
        payload: {
          waterDepth,
          breachPoint,
          breachWidth,
          releaseRate,
          friction,
          timeStep
        }
      }, [waterDepth.buffer]);
    });
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

// Stub Adapter for SPH Output Files
export class SPHSolverAdapter implements SolverAdapter {
  async init(gridSize: number, elevation: Float32Array): Promise<void> {
    console.log("SPHSolverAdapter: Init called. Ready to load precomputed SPH .bin frames.");
  }

  async step(waterDepth: Float32Array): Promise<{ waterDepth: Float32Array; arrivalTime: Float32Array }> {
    console.log("SPHSolverAdapter: Stub step executed.");
    return { waterDepth, arrivalTime: new Float32Array(waterDepth.length).fill(-1) };
  }

  terminate(): void {}
}

// Stub Adapter for Delft3D Output Files
export class Delft3DAdapter implements SolverAdapter {
  async init(gridSize: number, elevation: Float32Array): Promise<void> {
    console.log("Delft3DAdapter: Init called. Ready to load Delft3D NetCDF/Grid data.");
  }

  async step(waterDepth: Float32Array): Promise<{ waterDepth: Float32Array; arrivalTime: Float32Array }> {
    console.log("Delft3DAdapter: Stub step executed.");
    return { waterDepth, arrivalTime: new Float32Array(waterDepth.length).fill(-1) };
  }

  terminate(): void {}
}
