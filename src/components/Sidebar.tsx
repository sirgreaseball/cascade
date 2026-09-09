"use client";

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, Play, Pause, RotateCcw, Settings, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Sidebar() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [breachWidth, setBreachWidth] = useState(50);

  return (
    <motion.div 
      initial={{ x: -300 }}
      animate={{ x: 0 }}
      className="absolute top-0 left-0 h-full w-80 bg-secondary/95 backdrop-blur border-r border-muted z-10 flex flex-col shadow-2xl"
    >
      <div className="p-6 border-b border-muted">
        <div className="flex items-center gap-3 text-destructive font-bold text-xl tracking-wider">
          <ShieldAlert className="w-6 h-6" />
          <span>NTRO COMMAND</span>
        </div>
        <p className="text-muted-foreground text-xs font-mono mt-2 uppercase">Dam Break Inundation Model v2.1</p>
      </div>

      <div className="p-6 flex-1 flex flex-col gap-8 overflow-y-auto">
        {/* Simulation Controls */}
        <section className="space-y-4">
          <h2 className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Simulation Parameters
          </h2>
          
          <div className="space-y-2">
            <div className="flex justify-between text-sm font-mono">
              <span>Breach Width</span>
              <span className="text-accent">{breachWidth}m</span>
            </div>
            <input 
              type="range" 
              min="10" 
              max="200" 
              value={breachWidth}
              onChange={(e) => setBreachWidth(Number(e.target.value))}
              className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-accent"
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm font-mono">
              <span>Time Multiplier</span>
              <span className="text-accent">10x</span>
            </div>
            <input 
              type="range" 
              min="1" 
              max="100" 
              defaultValue="10"
              className="w-full h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-accent"
            />
          </div>
        </section>

        {/* Engine Controls */}
        <section className="space-y-4">
          <h2 className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Engine Control
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <button 
              onClick={() => setIsPlaying(!isPlaying)}
              className={cn(
                "flex items-center justify-center gap-2 p-2 rounded text-sm font-bold transition-colors",
                isPlaying ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isPlaying ? "HALT" : "INITIATE"}
            </button>
            <button className="flex items-center justify-center gap-2 p-2 rounded text-sm font-bold bg-muted hover:bg-muted/80 transition-colors">
              <RotateCcw className="w-4 h-4" />
              RESET
            </button>
          </div>
        </section>
      </div>

      <div className="p-4 border-t border-muted text-xs font-mono text-muted-foreground text-center">
        SYSTEM READY. AWAITING COMMAND.
      </div>
    </motion.div>
  );
}
