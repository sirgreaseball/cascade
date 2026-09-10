"use client";

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, Play, Pause, RotateCcw, Settings, Activity, Map } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useScenarioStore } from '@/store/scenarioStore';
import { useSimulationStore } from '@/store/simulationStore';

export default function BreachControlPanel() {
  const { activeScenario, basemap, scenarios, loadScenario, isLoading } = useScenarioStore();
  const { status, setStatus, breachWidth, breachDepth, releaseRate, setParameters, simulationSpeed, setSimulationSpeed, reset } = useSimulationStore();

  useEffect(() => {
    // Load default scenario
    loadScenario('tehri');
  }, [loadScenario]);

  return (
    <motion.div 
      initial={{ x: -300 }}
      animate={{ x: 0 }}
      className="pointer-events-auto absolute top-0 left-0 h-full w-80 bg-[#0f172a]/95 backdrop-blur border-r border-[#334155] z-10 flex flex-col shadow-2xl text-[#f8fafc]"
    >
      <div className="p-6 border-b border-[#334155]">
        <div className="flex items-center gap-3 text-[#ef4444] font-bold text-xl tracking-wider">
          <ShieldAlert className="w-6 h-6" />
          <span>NTRO COMMAND</span>
        </div>
        <p className="text-[#94a3b8] text-xs font-mono mt-2 uppercase">Dam Break Inundation Model</p>
      </div>

      <div className="p-6 flex-1 flex flex-col gap-8 overflow-y-auto">
        {/* Scenario Selection */}
        <section className="space-y-4">
          <h2 className="text-sm font-mono text-[#94a3b8] uppercase flex items-center gap-2">
            <Map className="w-4 h-4" />
            Target Scenario
          </h2>
          <select 
            className="w-full bg-[#1e293b] border border-[#334155] p-2 text-sm rounded font-mono outline-none"
            value={activeScenario?.id || 'tehri'}
            onChange={(e) => loadScenario(e.target.value)}
          >
            <option value="tehri">Tehri Dam (Bhagirathi River)</option>
            <option value="tehri-blockage">Bhagirathi Landslide Blockage</option>
            <option value="rishi_ganga">Rishi Ganga (Illustrative)</option>
            <option value="bhakra">Bhakra Nangal (Stub)</option>
          </select>
          {isLoading && <div className="text-xs text-[#f59e0b] animate-pulse">Loading scenario data...</div>}

          <div className="pt-2">
            <div className="flex items-center justify-between text-xs font-mono text-[#94a3b8] mb-2">
              <span>Basemap</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => useScenarioStore.getState().setBasemap('dark')}
                className={cn("p-1.5 rounded text-xs border transition-colors", 
                  basemap === 'dark' ? "bg-[#334155] border-[#475569] text-white" : "border-[#334155] text-[#94a3b8] hover:text-white"
                )}
              >
                Dark
              </button>
              <button 
                onClick={() => useScenarioStore.getState().setBasemap('satellite')}
                className={cn("p-1.5 rounded text-xs border transition-colors", 
                  basemap === 'satellite' ? "bg-[#334155] border-[#475569] text-white" : "border-[#334155] text-[#94a3b8] hover:text-white"
                )}
              >
                Satellite
              </button>
            </div>
          </div>
        </section>

        {/* Simulation Controls */}
        <section className="space-y-4">
          <h2 className="text-sm font-mono text-[#94a3b8] uppercase flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Breach Parameters
          </h2>
          
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-mono">
              <span>Breach Width (m)</span>
              <span className="text-[#f59e0b]">{breachWidth}</span>
            </div>
            <input 
              type="range" 
              min="10" 
              max="300" 
              value={breachWidth}
              onChange={(e) => setParameters(Number(e.target.value), breachDepth, releaseRate)}
              className="w-full h-1 bg-[#334155] rounded-lg appearance-none cursor-pointer accent-[#f59e0b]"
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs font-mono">
              <span>Simulation Speed</span>
              <span className="text-[#f59e0b]">{simulationSpeed}x</span>
            </div>
            <input 
              type="range" 
              min="1" 
              max="20" 
              value={simulationSpeed}
              onChange={(e) => setSimulationSpeed(Number(e.target.value))}
              className="w-full h-1 bg-[#334155] rounded-lg appearance-none cursor-pointer accent-[#f59e0b]"
            />
          </div>
        </section>

        {/* Engine Controls */}
        <section className="space-y-4">
          <h2 className="text-sm font-mono text-[#94a3b8] uppercase flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Engine Control
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <button 
              onClick={() => setStatus(status === 'running' ? 'paused' : 'running')}
              className={cn(
                "flex items-center justify-center gap-2 p-2 rounded text-sm font-bold transition-colors",
                status === 'running' ? "bg-[#ef4444] text-white hover:bg-[#ef4444]/90" : "bg-blue-600 text-white hover:bg-blue-600/90"
              )}
            >
              {status === 'running' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {status === 'running' ? "HALT" : "INITIATE"}
            </button>
            <button 
              onClick={reset}
              className="flex items-center justify-center gap-2 p-2 rounded text-sm font-bold bg-[#334155] hover:bg-[#334155]/80 transition-colors">
              <RotateCcw className="w-4 h-4" />
              RESET
            </button>
          </div>
          
          <div className="pt-4 border-t border-[#334155] space-y-2">
            <button 
              onClick={() => {
                const { activeScenario } = useScenarioStore.getState();
                if (activeScenario) {
                  import('@/lib/geeService').then(({ fetchNRTWaterExtent }) => {
                    useSimulationStore.getState().setStatus('paused');
                    fetchNRTWaterExtent(activeScenario.id).then(mask => {
                      if (mask) {
                        useScenarioStore.getState().setObservedData(mask);
                        console.log("Applied GEE mask.");
                        alert("NRT Data successfully loaded and overlaid on map.");
                      } else {
                        alert("GEE connection failed. No local offline fallback found.");
                        console.warn("GEE returned empty mask or failed.");
                      }
                    });
                  });
                }
              }}
              className="w-full flex items-center justify-center gap-2 p-2 rounded text-xs font-bold bg-[#1e293b] border border-[#334155] hover:bg-[#334155] text-blue-400 transition-colors"
            >
              FETCH NRT MASK (GEE STUB)
            </button>
            <button 
              onClick={() => useSimulationStore.getState().saveAsComparisonBaseline()}
              className="w-full flex items-center justify-center gap-2 p-2 rounded text-sm font-bold bg-[#1e293b] border border-[#334155] hover:bg-[#334155] text-orange-400 transition-colors"
            >
              SAVE AS BASELINE
            </button>
            {useSimulationStore.getState().comparisonWaterDepth && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-orange-400 text-center uppercase tracking-wider font-mono">
                  SPH-style Particle Visualization
                </span>
                <button 
                  onClick={() => useSimulationStore.getState().clearComparison()}
                  className="w-full flex items-center justify-center gap-2 p-2 rounded text-xs font-mono bg-transparent text-[#94a3b8] hover:text-white transition-colors"
                >
                  CLEAR BASELINE
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </motion.div>
  );
}
