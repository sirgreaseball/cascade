import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export default function FinalCTA() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.final-text', {
        yPercent: 100,
        opacity: 0,
        duration: 1.5,
        ease: 'power4.out',
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top 70%',
        }
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} className="relative w-full h-screen bg-[#050505] text-ink z-20 flex flex-col justify-between pt-0 pb-12 px-6 pointer-events-auto">
      
      {/* Spacer for top */}
      <div className="flex-none h-12"></div>

      {/* Perfectly Centered Content */}
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="overflow-hidden mb-12">
          <h2 className="final-text font-sans text-5xl md:text-8xl font-bold tracking-tighter uppercase text-white">
            ANTICIPATE THE CASCADE.
          </h2>
        </div>
        
        <a 
          href="/command"
          className="final-text group cursor-hover relative inline-flex items-center justify-center px-12 py-6 font-mono text-sm tracking-[0.3em] text-[#000000] bg-white transition-colors rounded-none hover:shadow-[0_0_40px_rgba(255,255,255,0.4)]"
          style={{ fontWeight: 600 }}
        >
          ENTER COMMAND CENTER &rarr;
        </a>
      </div>

      {/* Footer */}
      <div className="border-t border-white/10 pt-6 flex flex-col md:flex-row justify-between items-center gap-4 text-center md:text-left font-mono text-[10px] tracking-widest text-dim uppercase">
        <p>Built for Smart India Hackathon   SIH26161   NTRO</p>
        <p>Open data: SRTM/Copernicus DEM, Sentinel via Google Earth Engine</p>
      </div>
    </section>
  );
}
