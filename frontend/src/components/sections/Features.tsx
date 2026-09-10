import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
gsap.registerPlugin(ScrollTrigger);

export default function Features() {
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    const sections = gsap.utils.toArray<HTMLElement>('.feature-section');
    
    const ctx = gsap.context(() => {
      sections.forEach((section) => {
        // Pin each section and fade text in/out as we scroll
        ScrollTrigger.create({
          trigger: section,
          start: 'top center',
          end: 'bottom center',
          toggleClass: 'active',
          animation: gsap.fromTo(section.querySelector('.feature-content'), 
            { opacity: 0, x: -50 }, 
            { opacity: 1, x: 0, duration: 1 }
          ),
          toggleActions: 'play reverse play reverse'
        });
      });
    }, containerRef);
    
    return () => ctx.revert();
  }, []);

  return (
    <div ref={containerRef} className="w-full relative z-10 px-4 md:px-24">
      
      {/* Section 1 */}
      <section className="feature-section h-screen w-full flex items-center">
        <div className="feature-content max-w-xl">
          <p className="font-mono text-sm tracking-[0.2em] text-accent mb-4 uppercase">01 / Physics Engine</p>
          <h2 className="font-sans text-4xl md:text-6xl font-bold tracking-tighter text-white mb-6 leading-none">
            Navier-Stokes<br/>Fluid Dynamics.
          </h2>
          <p className="text-slate-400 text-lg md:text-xl font-light">
            Calculated in real-time within the browser using Web Workers. Millions of floating point operations per second without dropping a single frame.
          </p>
        </div>
      </section>
      
      {/* Section 2 */}
      <section className="feature-section h-screen w-full flex items-center justify-end">
        <div className="feature-content max-w-xl text-right">
          <p className="font-mono text-sm tracking-[0.2em] text-accent mb-4 uppercase">02 / Topography</p>
          <h2 className="font-sans text-4xl md:text-6xl font-bold tracking-tighter text-white mb-6 leading-none">
            Satellite SRTM<br/>Integration.
          </h2>
          <p className="text-slate-400 text-lg md:text-xl font-light ml-auto">
            Ingesting raw 30-meter resolution Digital Elevation Models to ensure physical accuracy across any Himalayan river valley.
          </p>
        </div>
      </section>

      {/* Section 3 */}
      <section className="feature-section h-[100vh] w-full flex items-center">
        <div className="feature-content max-w-xl">
          <p className="font-mono text-sm tracking-[0.2em] text-accent mb-4 uppercase">03 / Readiness</p>
          <h2 className="font-sans text-4xl md:text-6xl font-bold tracking-tighter text-white mb-6 leading-none">
            Humanitarian<br/>Action.
          </h2>
          <p className="text-slate-400 text-lg md:text-xl font-light">
            Instantaneous ETA and depth calculations for downstream infrastructure. Export compliant GeoJSON and KML directly to disaster response teams.
          </p>
        </div>
      </section>
      
    </div>
  );
}
