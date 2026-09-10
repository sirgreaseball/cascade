"use client";

import React from 'react';
import { Activity, Building2, Car, Users } from 'lucide-react';
import { motion } from 'framer-motion';
import { useSimulationStore } from '@/store/simulationStore';

export default function ImpactPanel() {
  const { impacts } = useSimulationStore();

  return (
    <motion.div 
      initial={{ x: -300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className="pointer-events-auto absolute bottom-6 left-6 w-80 bg-[#0f172a]/95 backdrop-blur border border-[#334155] p-4 text-[#f8fafc] flex flex-col gap-4 rounded shadow-xl"
    >
      <div className="flex items-center gap-2 border-b border-[#334155] pb-2">
        <Activity className="text-red-500 w-5 h-5" />
        <h2 className="font-mono text-sm tracking-widest text-[#94a3b8]">LIVE IMPACT</h2>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col">
          <span className="text-xs text-[#94a3b8] font-mono">BUILDINGS</span>
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[#ef4444]" />
            <span className="text-xl font-bold">{impacts.buildingsAffected}</span>
          </div>
        </div>

        <div className="flex flex-col">
          <span className="text-xs text-[#94a3b8] font-mono">ROADS / BRIDGES</span>
          <div className="flex items-center gap-2">
            <Car className="w-4 h-4 text-[#ef4444]" />
            <span className="text-xl font-bold">{impacts.roadsAffected}</span>
          </div>
        </div>

        <div className="flex flex-col col-span-2">
          <span className="text-xs text-[#94a3b8] font-mono">POPULATION AT RISK</span>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#ef4444]" />
            <span className="text-2xl font-bold text-red-500">{impacts.populationAtRisk.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
