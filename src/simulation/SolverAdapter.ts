export interface SolverAdapter {
  init(gridSize: number, elevation: Float32Array): Promise<void>;
  step(
    waterDepth: Float32Array,
    breachPoint: { x: number; y: number },
    breachWidth: number,
    releaseRate: number,
    friction: number,
    timeStep: number
  ): Promise<{ waterDepth: Float32Array; arrivalTime: Float32Array }>;
  terminate(): void;
}
