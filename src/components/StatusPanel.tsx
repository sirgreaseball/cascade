"use client";

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Users, Droplets } from 'lucide-react';

export default function StatusPanel() {
  // Placeholder data that would normally be updated by the simulation
  const isDanger = true;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="absolute top-6 right-6 z-10 flex flex-col gap-4 w-80"
      >
        {/* Main Alert Banner */}
        <div className="bg-destructive/20 border border-destructive text-destructive px-4 py-3 rounded backdrop-blur shadow-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 animate-pulse" />
          <div>
            <h3 className="font-bold tracking-widest text-sm mb-1 uppercase">Critical Alert</h3>
            <p className="text-xs font-mono">Simulated Dam Breach in progress. Downstream inundation imminent.</p>
          </div>
        </div>

        {/* Stats Readout */}
        <div className="bg-secondary/90 border border-muted rounded backdrop-blur shadow-lg overflow-hidden">
          <div className="bg-muted px-3 py-1.5 text-xs font-mono text-muted-foreground border-b border-muted">
            IMPACT ESTIMATE
          </div>
          <div className="p-3 grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                <Users className="w-3.5 h-3.5" />
                Pop. at Risk
              </div>
              <div className="text-xl font-bold text-accent">12,450</div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                <Droplets className="w-3.5 h-3.5" />
                Peak Flow
              </div>
              <div className="text-xl font-bold text-blue-400">45k <span className="text-xs font-normal text-muted-foreground">m³/s</span></div>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
