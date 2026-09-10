"use client";

import React from 'react';
import { motion } from 'framer-motion';

export default function Header() {
  return (
    <motion.header 
      initial={{ y: -50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="pointer-events-auto absolute top-0 left-80 right-0 h-12 bg-[#0f172a]/95 backdrop-blur border-b border-[#334155] z-10 flex items-center justify-between px-6 shadow-2xl text-[#f8fafc]"
    >
      <div className="font-mono text-sm tracking-widest text-[#94a3b8]">
        PROJECT: <span className="text-[#f8fafc]">CASCADE</span> // COMMAND CENTER
      </div>
      <div className="flex items-center gap-4 text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          SYSTEM ONLINE
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#f59e0b] animate-pulse" />
          WORKER STANDBY
        </div>
      </div>
    </motion.header>
  );
}
