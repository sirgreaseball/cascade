"use client";

import React from 'react';
import { Activity, Building2, Car, Users } from 'lucide-react';
import { motion } from 'framer-motion';
import { useSimulationStore } from '@/store/simulationStore';
import { formatCurrency } from '@/lib/damage';

export default function ImpactPanel() {
  const { impacts, comparisonImpacts } = useSimulationStore();

  return (
    <motion.div 
      initial={{ x: -300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className="pointer-events-auto absolute bottom-6 left-6 w-96 bg-[#0f172a]/95 backdrop-blur border border-[#334155] p-4 text-[#f8fafc] flex flex-col gap-4 rounded shadow-xl"
    >
      <div className="flex items-center gap-2 border-b border-[#334155] pb-2 justify-between">
        <div className="flex items-center gap-2">
          <Activity className="text-red-500 w-5 h-5" />
          <h2 className="font-mono text-sm tracking-widest text-[#94a3b8]">LIVE IMPACT</h2>
        </div>
        {comparisonImpacts && (
          <span className="text-xs font-mono bg-[#334155] px-2 py-0.5 rounded text-orange-400 border border-orange-500/30">
            VS BASELINE
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col">
          <span className="text-xs text-[#94a3b8] font-mono">INUNDATED AREA</span>
          <div className="flex items-end gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold">{impacts.inundatedArea ? impacts.inundatedArea.toFixed(2) : 0} km²</span>
            </div>
            {comparisonImpacts && (
              <span className="text-sm font-mono text-orange-400 mb-0.5">({comparisonImpacts.inundatedArea ? comparisonImpacts.inundatedArea.toFixed(2) : 0} km²)</span>
            )}
          </div>
        </div>

        <div className="flex flex-col">
          <span className="text-xs text-[#94a3b8] font-mono">TIME TO IMPACT</span>
          <div className="flex items-end gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold">T+ {impacts.timeToImpact || 0}s</span>
            </div>
            {comparisonImpacts && (
              <span className="text-sm font-mono text-orange-400 mb-0.5">(T+ {comparisonImpacts.timeToImpact || 0}s)</span>
            )}
          </div>
        </div>

        <div className="flex flex-col pt-2 border-t border-[#334155]">
          <span className="text-xs text-[#94a3b8] font-mono">BUILDINGS</span>
          <div className="flex items-end gap-3">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[#ef4444]" />
              <span className="text-xl font-bold">{impacts.buildingsAffected}</span>
            </div>
            {comparisonImpacts && (
              <span className="text-sm font-mono text-orange-400 mb-0.5">({comparisonImpacts.buildingsAffected})</span>
            )}
          </div>
        </div>

        <div className="flex flex-col pt-2 border-t border-[#334155]">
          <span className="text-xs text-[#94a3b8] font-mono">ROADS / BRIDGES</span>
          <div className="flex items-end gap-3">
            <div className="flex items-center gap-2">
              <Car className="w-4 h-4 text-[#ef4444]" />
              <span className="text-xl font-bold">{impacts.roadsAffected}</span>
            </div>
            {comparisonImpacts && (
              <span className="text-sm font-mono text-orange-400 mb-0.5">({comparisonImpacts.roadsAffected})</span>
            )}
          </div>
        </div>

        <div className="flex flex-col col-span-2 pt-2 border-t border-[#334155]">
          <span className="text-xs text-[#94a3b8] font-mono">POPULATION AT RISK</span>
          <div className="flex items-end gap-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#ef4444]" />
              <span className="text-2xl font-bold text-red-500">{impacts.populationAtRisk.toLocaleString()}</span>
            </div>
            {comparisonImpacts && (
              <span className="text-lg font-mono text-orange-400 mb-0.5">({comparisonImpacts.populationAtRisk.toLocaleString()})</span>
            )}
          </div>
        </div>

        <div className="flex flex-col col-span-2 pt-2 border-t border-[#334155]">
          <span className="text-xs text-[#94a3b8] font-mono flex items-center justify-between">
            ESTIMATED FINANCIAL LOSS
            <span className="text-[10px] text-orange-300 bg-orange-900/30 px-1 rounded">Indicative Estimate</span>
          </span>
          <div className="flex items-end gap-3">
            <span className="text-xl font-bold text-[#f8fafc]">{formatCurrency(impacts.estimatedLoss)}</span>
            {comparisonImpacts && (
              <span className="text-sm font-mono text-orange-400 mb-0.5">({formatCurrency(comparisonImpacts.estimatedLoss)})</span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
