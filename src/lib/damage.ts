import { ImpactResult } from '@/types';

// Constants representing rough INR loss per unit
export const UNIT_COSTS = {
  building: 1500000, // 1.5M INR per building destroyed
  roadKm: 50000000,   // 50M INR per km of road washed away
  populationRelief: 50000 // 50k INR per person for evacuation/relief
};

export function calculateEstimatedLoss(buildingsAffected: number, roadsAffected: number, populationAtRisk: number): number {
  // Assuming roadsAffected in the UI loosely translates to approx km or generic units
  const buildingLoss = buildingsAffected * UNIT_COSTS.building;
  const roadLoss = roadsAffected * UNIT_COSTS.roadKm;
  const reliefCost = populationAtRisk * UNIT_COSTS.populationRelief;

  return buildingLoss + roadLoss + reliefCost;
}

export function formatCurrency(amount: number): string {
  if (amount === 0) return '₹0';
  if (amount >= 1e7) {
    return `₹${(amount / 1e7).toFixed(2)} Cr`;
  }
  if (amount >= 1e5) {
    return `₹${(amount / 1e5).toFixed(2)} L`;
  }
  return `₹${amount.toLocaleString()}`;
}
