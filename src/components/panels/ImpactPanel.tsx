"use client";

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Users, Droplets, MapPin, Activity } from 'lucide-react';
import { useSimulationStore } from '@/store/simulationStore';

export default function ImpactPanel() {
  const { status, currentStep } = useSimulationStore();
  const isDanger = status === 'running' || status === 'paused';

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="pointer-events-auto absolute top-6 right-6 z-10 flex flex-col gap-4 w-80 text-[#f8fafc]"
      >
        {isDanger && (
          <div className="bg-[#dc2626]/20 border border-[#dc2626] text-[#ef4444] px-4 py-3 rounded backdrop-blur shadow-lg flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 animate-pulse" />
            <div>
              <h3 className="font-bold tracking-widest text-sm mb-1 uppercase">Critical Alert</h3>
              <p className="text-xs font-mono">Dam Breach simulation active. Step: {currentStep}</p>
            </div>
          </div>
        )}

        {/* Stats Readout */}
        <div className="bg-[#0f172a]/95 border border-[#334155] rounded backdrop-blur shadow-lg overflow-hidden">
          <div className="bg-[#1e293b] px-3 py-1.5 text-xs font-mono text-[#94a3b8] border-b border-[#334155] flex justify-between">
            <span>IMPACT ESTIMATE</span>
            <span className="text-[#f59e0b] animate-pulse">LIVE</span>
          </div>
          <div className="p-3 grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-[#94a3b8] font-mono">
                <Users className="w-3.5 h-3.5" />
                Pop. at Risk
              </div>
              <div className="text-xl font-bold text-[#ef4444]">
                {isDanger ? '1,450' : '0'}
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-[#94a3b8] font-mono">
                <Activity className="w-3.5 h-3.5" />
                Villages Hit
              </div>
              <div className="text-xl font-bold text-[#f59e0b]">
                {isDanger ? '2' : '0'}
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-[#94a3b8] font-mono">
                <MapPin className="w-3.5 h-3.5" />
                Evac Routes
              </div>
              <div className="text-xl font-bold text-[#ef4444]">
                {isDanger ? '1 Blocked' : 'Clear'}
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-[#94a3b8] font-mono">
                <Droplets className="w-3.5 h-3.5" />
                Time to Hit
              </div>
              <div className="text-xl font-bold text-blue-400">
                {isDanger ? '14 min' : '--'}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
