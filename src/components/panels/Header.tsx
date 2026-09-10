"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { Activity, Download } from 'lucide-react';
import { useSimulationStore } from '@/store/simulationStore';
import { useScenarioStore } from '@/store/scenarioStore';
import { generateInundationGeoJSON, downloadKML, downloadShapefile } from '@/lib/export';

export default function Header() {
  const { status, waterDepth, floodedFeatureIds } = useSimulationStore();
  const { activeScenario, infrastructureData } = useScenarioStore();

  const handleExport = (format: 'kml' | 'shp') => {
    if (!activeScenario || !waterDepth) return;
    
    const geojson = generateInundationGeoJSON(
      waterDepth,
      activeScenario.gridSize,
      activeScenario.bbox,
      floodedFeatureIds,
      infrastructureData
    );

    if (format === 'kml') {
      downloadKML(geojson, activeScenario.id);
    } else {
      downloadShapefile(geojson, activeScenario.id);
    }
  };

  return (
    <motion.header 
      initial={{ y: -50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="pointer-events-auto absolute top-0 left-80 right-0 h-16 bg-[#0f172a]/95 backdrop-blur border-b border-[#334155] z-10 flex items-center justify-between px-6 shadow-2xl text-[#f8fafc]"
    >
      <div className="font-mono text-sm tracking-widest text-[#94a3b8]">
        PROJECT: <span className="text-[#f8fafc]">CASCADE</span> // COMMAND CENTER
      </div>
      
      <div className="flex items-center gap-4 text-xs font-mono">
        {/* Export Group */}
        <div className="flex items-center gap-2 bg-[#1e293b] rounded p-1 border border-[#334155]">
          <span className="text-[#94a3b8] px-2 flex items-center gap-1">
            <Download className="w-3 h-3" /> EXPORT
          </span>
          <button 
            onClick={() => handleExport('kml')}
            disabled={!waterDepth}
            className="px-3 py-1 bg-[#334155] hover:bg-[#475569] text-white rounded transition-colors disabled:opacity-50"
          >
            .KML
          </button>
          <button 
            onClick={() => handleExport('shp')}
            disabled={!waterDepth}
            className="px-3 py-1 bg-[#334155] hover:bg-[#475569] text-white rounded transition-colors disabled:opacity-50"
          >
            .SHP
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${status === 'running' ? 'bg-green-500 animate-pulse' : 'bg-[#f59e0b]'}`} />
          {status === 'running' ? 'SYSTEM ONLINE' : 'WORKER STANDBY'}
        </div>
      </div>
    </motion.header>
  );
}
