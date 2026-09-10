import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';

const ARCHITECTURE = [
  {
    title: 'AI PREDICTION CORE',
    description: 'Real-time cellular automata fluid dynamics running in the browser, matching 512² grid resolution without dedicated hardware.',
    icon: '01',
    status: 'ACTIVE',
    popupText: 'SYSTEM LOG: Neural network prediction module engaged. Fluid dynamics tensor initialized at full capacity.',
  },
  {
    title: 'SATELLITE UPLINK',
    description: 'Sentinel-1 SAR data validation pipeline ensuring historical models align perfectly with live disaster telemetry.',
    icon: '02',
    status: 'SYNCED',
    popupText: 'SYSTEM LOG: Copernicus DEM payload downloaded. Live SAR feed synchronizing with ground truth.',
  },
  {
    title: 'INFRASTRUCTURE GRAPH',
    description: 'Dynamic graph database overlay routing cascading damage effects to roads, bridges, and civilian populations instantaneously.',
    icon: '03',
    status: 'ONLINE',
    popupText: 'SYSTEM LOG: Graph database overlay active. 140,000+ nodes continuously monitoring for vulnerability.',
  }
];

export default function SystemArchitecture() {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { once: true, margin: "-20%" });

  return (
    <section ref={containerRef} className="w-full bg-[#050505] text-ink pt-32 pb-48 px-6 relative z-10 pointer-events-auto">
      <div className="max-w-7xl mx-auto">
        
        <div className="mb-24 text-center md:text-left flex flex-col md:flex-row justify-between items-end border-b border-white/10 pb-8">
          <div>
            <h3 className="font-mono text-xs tracking-[0.2em] uppercase text-accent mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-accent rounded-full animate-pulse" />
              System Architecture
            </h3>
            <h2 className="font-serif italic text-4xl md:text-6xl tracking-tight max-w-3xl text-white leading-none">
              Military-grade intelligence,<br />running in your browser.
            </h2>
          </div>
          <div className="hidden md:block text-right font-mono text-[10px] text-dim tracking-widest uppercase">
            <p>NODE DEPLOYMENT: BROWSER CLUSTER</p>
            <p>ENCRYPTION: AES-256 (SIMULATED)</p>
          </div>
        </div>

        {/* Redesigned Widgets - Expanded */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          {ARCHITECTURE.map((item, index) => (
            <motion.div
              key={item.icon}
              initial={{ opacity: 0, y: 30 }}
              animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
              transition={{ duration: 0.8, delay: index * 0.15, ease: [0.16, 1, 0.3, 1] }}
              className="relative border border-white/10 bg-white/[0.01] hover:bg-white/[0.05] transition-all duration-500 group cursor-hover min-h-[300px] flex flex-col justify-center items-center rounded-[2rem]"
            >
              
              {/* Internal padding container */}
              <div className="p-10 flex-1 flex flex-col justify-center items-center text-center relative w-full">
                
                {/* Absolutely positioned header to ensure body text stays perfectly vertically centered */}
                <div className="absolute top-8 left-8 right-8 flex justify-between items-start">
                  <span className="font-mono text-sm tracking-[0.2em] text-dim group-hover:text-white transition-colors block">
                    SYS.{item.icon}
                  </span>
                  <span className="font-mono text-[10px] px-3 py-1 bg-accent/10 text-accent border border-accent/20 rounded-full tracking-widest">
                    {item.status}
                  </span>
                </div>
                
                <div className="flex flex-col items-center mt-6">
                  <h4 className="font-sans text-3xl font-bold uppercase tracking-tighter mb-6 text-white group-hover:text-accent transition-colors">
                    {item.title}
                  </h4>
                  <p className="font-mono text-sm text-dim/80 leading-relaxed max-w-sm">
                    {item.description}
                  </p>
                </div>
              </div>

              {/* iOS Glass Hover Popup - MOVED TO BOTTOM */}
              <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 translate-y-full w-64 p-4 rounded-2xl bg-white/10 backdrop-blur-2xl border border-white/20 opacity-0 group-hover:opacity-100 transition-all duration-500 shadow-[0_8px_32px_rgba(0,0,0,0.5)] pointer-events-none transform group-hover:translate-y-full group-hover:scale-100 scale-95 z-50">
                <p className="font-mono text-[10px] tracking-widest text-dim/90 uppercase leading-relaxed text-left">
                  {item.popupText}
                </p>
                {/* Little triangle arrow pointing up */}
                <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-white/10 backdrop-blur-2xl border-t border-l border-white/20 rotate-45" />
              </div>
            </motion.div>
          ))}
        </div>
        
      </div>
    </section>
  );
}
