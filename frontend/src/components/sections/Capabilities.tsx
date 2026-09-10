import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

const CAPABILITIES = [
  {
    id: '01',
    title: 'REAL-TIME INUNDATION',
    desc: 'Shallow-water finite-volume solver on real SRTM terrain, 60+ fps in-browser',
    popupText: 'HLL Riemann solver with wetting and drying. Depth, velocity and arrival time are computed cell by cell over the real valley, with mass conserved to machine precision.',
  },
  {
    id: '02',
    title: 'CASCADING IMPACT',
    desc: 'Roads, bridges, hospitals, schools and settlements flagged as the water arrives',
    popupText: 'OpenStreetMap exposure layer. Every asset is checked against depth and velocity as the flood advances, graded H1–H6 and costed in rupees with JRC depth-damage curves.',
  },
  {
    id: '03',
    title: 'SCENARIO COMPARISON',
    desc: 'Any Indian dam, custom breach, shallow-water vs SPH side by side',
    popupText: 'Froehlich breach model draining a real reservoir. Run both solvers on the same scenario and compare extent agreement (CSI) and depth difference.',
  },
  {
    id: '04',
    title: 'EXPORT & VALIDATION',
    desc: '.KML / .SHP export, Sentinel-1 validation via Google Earth Engine',
    popupText: 'Extent, depth and hazard polygons packaged as KML, Shapefile, GeoJSON and GIS rasters. Observed Sentinel-1 flood extents load back in and score the model.',
  }
];

export default function Capabilities() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start center", "end end"]
  });

  // Animate the stroke length from 0 to 1 based on scroll progress
  const pathLength = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <section ref={containerRef} className="relative w-full text-ink py-40 min-h-[400vh] pointer-events-auto overflow-hidden md:overflow-visible">
      
      {/* Scroll-Driven SVG Canvas - Centered */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden flex justify-center">
        <svg 
          className="w-full h-full max-w-5xl" 
          viewBox="0 0 1000 3000" 
          preserveAspectRatio="xMidYMin slice"
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Subtle background track */}
          <path 
            d="M500,0 C500,200 800,300 800,500 C800,700 200,900 200,1200 C200,1500 900,1700 900,2000 C900,2300 300,2500 300,2800 C300,2900 500,3000 500,3000" 
            stroke="rgba(255,255,255,0.02)" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
          />
          {/* Glowing Animated Stroke */}
          <motion.path 
            d="M500,0 C500,200 800,300 800,500 C800,700 200,900 200,1200 C200,1500 900,1700 900,2000 C900,2300 300,2500 300,2800 C300,2900 500,3000 500,3000" 
            stroke="url(#gradient)" 
            strokeWidth="3" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            style={{ pathLength }}
            className="drop-shadow-[0_0_10px_rgba(245,158,11,0.8)]"
          />
          <defs>
            <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0" />
              <stop offset="10%" stopColor="#f59e0b" stopOpacity="1" />
              <stop offset="90%" stopColor="#ef4444" stopOpacity="1" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6">
        
        {/* Section Header */}
        <div className="text-center mb-64">
          <h3 className="font-mono text-xs tracking-widest text-dim mb-4">CAPABILITIES</h3>
          <p className="font-serif italic text-3xl text-dim max-w-2xl mx-auto">
            Following the thread of destruction from origin to impact.
          </p>
        </div>

        {/* Zig-Zag Layout */}
        <div className="flex flex-col gap-96 relative">
          {CAPABILITIES.map((cap, index) => {
            const isLeft = index % 2 === 0;
            return (
              <div 
                key={cap.id} 
                className={`flex w-full ${isLeft ? 'justify-start' : 'justify-end'} items-center relative`}
              >
                <div className="max-w-lg bg-[#050505]/80 backdrop-blur-md p-8 md:p-12 border border-white/5 shadow-2xl relative group hover:border-white/10 transition-colors cursor-hover rounded-[2rem]">
                  
                  {/* Subtle connection glow */}
                  <div className={`absolute top-1/2 -translate-y-1/2 ${isLeft ? '-right-12' : '-left-12'} w-24 h-[1px] bg-gradient-to-r ${isLeft ? 'from-white/20 to-transparent' : 'from-transparent to-white/20'} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

                  <span className="font-mono text-xs text-accent mb-6 block">
                    {cap.id}
                  </span>
                  <h3 className="font-sans text-3xl md:text-5xl font-bold uppercase tracking-tighter mb-4 text-white group-hover:text-accent transition-colors">
                    {cap.title}
                  </h3>
                  <p className="font-mono text-sm leading-relaxed text-dim/80">
                    {cap.desc}
                  </p>

                  {/* iOS Glass Hover Popup */}
                  <div 
                    className={`absolute top-1/2 -translate-y-1/2 ${isLeft ? '-right-8 translate-x-full' : '-left-8 -translate-x-full'} w-64 p-4 rounded-2xl bg-white/10 backdrop-blur-2xl border border-white/20 opacity-0 group-hover:opacity-100 transition-all duration-500 shadow-[0_8px_32px_rgba(0,0,0,0.5)] pointer-events-none transform scale-95 group-hover:scale-100 z-50 hidden md:block`}
                  >
                    <p className="font-mono text-[10px] tracking-widest text-dim/90 uppercase leading-relaxed text-left">
                      {cap.popupText}
                    </p>
                    {/* Little triangle arrow pointing towards the card */}
                    <div className={`absolute top-1/2 -translate-y-1/2 ${isLeft ? '-left-2' : '-right-2'} w-4 h-4 bg-white/10 backdrop-blur-2xl ${isLeft ? 'border-b border-l' : 'border-t border-r'} border-white/20 rotate-45`} />
                  </div>

                </div>
              </div>
            );
          })}
        </div>
      </div>
      
    </section>
  );
}
