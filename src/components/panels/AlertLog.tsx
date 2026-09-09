"use client";

import React from 'react';
import { motion } from 'framer-motion';

export default function AlertLog() {
  return (
    <motion.div 
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="pointer-events-auto absolute bottom-6 left-[340px] right-6 h-32 bg-[#0f172a]/90 backdrop-blur border border-[#334155] rounded z-10 flex flex-col shadow-2xl text-[#f8fafc] overflow-hidden"
    >
      <div className="bg-[#1e293b] px-3 py-1 text-xs font-mono text-[#94a3b8] border-b border-[#334155]">
        SYSTEM LOG
      </div>
      <div className="p-3 flex-1 overflow-y-auto space-y-2 font-mono text-xs">
        <div className="text-[#94a3b8]">[00:00:00] System initialized. Awaiting command.</div>
        <div className="text-[#f59e0b]">[00:00:05] Tehri Dam scenario loaded.</div>
        <div className="text-[#ef4444] opacity-50">[00:10:00] (Simulated) Bridge B-04 compromised.</div>
      </div>
    </motion.div>
  );
}
