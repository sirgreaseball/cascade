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
  cellSize: number; // in meters
  breachPoint: {
    x: number; // grid x coordinate
    y: number; // grid y coordinate
  };
  breachPresets: BreachPreset[];
  simulation: {
    friction: number;
    timeStep: number;
    maxSteps: number;
  };
};

export type InfrastructureFeatureProperties = {
  type: 'village' | 'bridge' | 'highway' | 'hospital' | 'evacuation_route';
  name: string;
  population?: number;
};
