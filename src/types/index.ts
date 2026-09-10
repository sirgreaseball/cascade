export type BreachPreset = {
  name: string;
  breachWidth: number;
  breachDepth: number;
  releaseRate: number;
};

export type Scenario = {
  id: string;
  name: string;
  river: string;
  center: [number, number];
  bbox: [number, number, number, number];
  demUrl: string;
  infrastructureUrl: string;
  evacuationUrl: string;
  gridSize: number;
  cellSize: number;
  breachPoint: {
    x: number;
    y: number;
  };
  breachPresets: BreachPreset[];
  simulation: {
    friction: number;
    timeStep: number;
    maxSteps: number;
  };
};

export type SimulationInput = {
  waterDepth: Float32Array;
  breachPoint: { x: number; y: number };
  breachWidth: number;
  releaseRate: number;
  friction: number;
  timeStep: number;
};

export type SimulationOutput = {
  waterDepth: Float32Array;
  arrivalTime: Float32Array;
};

export type ImpactResult = {
  buildingsAffected: number;
  roadsAffected: number;
  populationAtRisk: number;
  estimatedLoss: number;
  inundatedArea: number;
  timeToImpact: number;
};

export type AlertItem = {
  id: string;
  timestamp: number;
  message: string;
  severity: 'low' | 'medium' | 'high';
};
