import { SolverAdapter } from './SolverAdapter';

export class CASolverAdapter implements SolverAdapter {
  private worker: Worker | null = null;

  async init(gridSize: number, elevation: Float32Array): Promise<void> {
    return new Promise((resolve) => {
      this.worker = new Worker(new URL('./floodWorker.ts', import.meta.url));
      this.worker.postMessage({
        type: 'INIT',
        payload: { gridSize, elevation }
      });
      
      const onReady = (e: MessageEvent) => {
        if (e.data.type === 'READY') {
          this.worker?.removeEventListener('message', onReady);
          resolve();
        }
      };
      this.worker.addEventListener('message', onReady);
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
