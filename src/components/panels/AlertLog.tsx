"use client";

import React, { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useSimulationStore } from '@/store/simulationStore';

export default function AlertLog() {
  const { alerts, status } = useSimulationStore();
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [alerts]);

  return (
    <motion.div 
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="pointer-events-auto absolute bottom-6 left-[340px] right-6 h-32 bg-[#0f172a]/90 backdrop-blur border border-[#334155] rounded z-10 flex flex-col shadow-2xl text-[#f8fafc] overflow-hidden"
    >
      <div className="bg-[#1e293b] px-3 py-1 text-xs font-mono text-[#94a3b8] border-b border-[#334155]">
        SYSTEM LOG
      </div>
      <div ref={logRef} className="p-3 flex-1 overflow-y-auto space-y-2 font-mono text-xs">
        <div className="text-[#94a3b8]">[00:00:00] System initialized. Awaiting command.</div>
        {status === 'running' && <div className="text-[#f59e0b]">[00:00:01] Simulation started.</div>}
        {alerts.map((alert, i) => (
          <div key={i} className="text-[#ef4444]">
            [{alert.timestamp.toString().padStart(6, '0')}] {alert.message}
          </div>
        ))}
      </div>
    </motion.div>
  );
}
