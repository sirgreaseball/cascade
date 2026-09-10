import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';

export default function Preloader() {
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const wipeRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const tl = gsap.timeline({
      onComplete: () => {
        if (containerRef.current) {
          containerRef.current.style.display = 'none';
        }
        window.dispatchEvent(new CustomEvent('preloaderComplete'));
      }
    });

    const obj = { value: 0 };
    tl.to(obj, {
      value: 100,
      duration: 1.5,
      ease: 'power3.inOut',
      onUpdate: () => {
        setProgress(Math.round(obj.value));
        if (progressRef.current) {
          progressRef.current.style.width = obj.value + '%';
        }
      }
    });

    // Wipe text reveal
    tl.to(wipeRef.current, {
      clipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)',
      duration: 0.8,
      ease: 'expo.inOut'
    }, "-=0.2");

    // Curtain lift
    tl.to(containerRef.current, {
      yPercent: -100,
      duration: 1,
      ease: 'power4.inOut'
    }, "+=0.3");

    return () => { tl.kill(); };
  }, []);

  return (
    <div ref={containerRef} className="fixed inset-0 z-50 bg-[#050505] flex flex-col items-center justify-center pointer-events-none">
      
      {/* Wipe Text - Claude Elegant Serif */}
      <div className="relative overflow-hidden">
        <div ref={wipeRef} className="font-serif italic text-6xl md:text-9xl font-light tracking-tight text-white/90 drop-shadow-[0_0_30px_rgba(255,255,255,0.15)]" style={{ clipPath: 'polygon(0% 100%, 100% 100%, 100% 100%, 0% 100%)' }}>
          Cascade
        </div>
      </div>

      {/* Redesigned Loading Meter at Bottom */}
      <div className="absolute bottom-10 left-10 right-10 flex flex-col justify-end">
        <div className="flex justify-between items-end mb-4 font-mono text-[10px] tracking-[0.2em] text-dim uppercase">
            <span>INITIALIZING FLUID DYNAMICS...</span>
            <span className="text-white">
              {progress < 10 ? `00${progress}` : progress < 100 ? `0${progress}` : progress}%
            </span>
        </div>
        <div className="h-[1px] w-full bg-white/10 relative overflow-hidden">
          <div ref={progressRef} className="absolute top-0 left-0 h-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)] w-0" />
        </div>
      </div>

    </div>
  );
}
