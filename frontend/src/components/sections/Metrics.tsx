import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const metrics = [
  { value: '512²', label: 'GRID' },
  { value: '60', label: 'FPS' },
  { value: '<2s', label: 'LOAD' },
  { value: '4', label: 'SCENARIOS' },
  { value: 'T+', label: 'SECONDS TO IMPACT' },
  { value: '₹', label: 'LOSS ESTIMATE' }
];

export default function Metrics() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.metric-item', {
        y: 50,
        opacity: 0,
        stagger: 0.1,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: containerRef.current,
          start: 'top 80%',
        }
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} className="relative w-full bg-[#f59e0b] text-[#050505] z-20 py-24 pointer-events-auto">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8 gap-y-16">
          {metrics.map((m, i) => (
            <div key={i} className="metric-item flex flex-col border-l border-[#050505]/20 pl-6">
              <span className="font-mono text-4xl md:text-5xl font-bold tracking-tighter mb-2">{m.value}</span>
              <span className="font-mono text-[10px] tracking-widest font-bold uppercase">{m.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
