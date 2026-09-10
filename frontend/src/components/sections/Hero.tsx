import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export default function Hero() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePreloaderComplete = () => {
      // Instead of relying on overflow-hidden, we use opacity and a slight y shift
      gsap.from('.hero-text-anim', {
        y: 40,
        opacity: 0,
        duration: 1.5,
        stagger: 0.1,
        ease: 'power4.out',
      });
      gsap.to('.hud-element', {
        opacity: 1,
        duration: 1,
        stagger: 0.1,
        delay: 0.5,
      });

      // Cinematic Blur and Fade Out on Scroll - Extended dramatically
      gsap.to('.hero-content', {
        opacity: 0,
        y: -50, // Move less, fade longer
        scale: 1.05,
        filter: 'blur(20px)',
        scrollTrigger: {
          trigger: '.hero-section',
          start: 'top top',
          end: '+=200%', // Fade out over 200% of viewport height instead of 150%
          scrub: true,
        }
      });
    };
    
    window.addEventListener('preloaderComplete', handlePreloaderComplete);
    const timeout = setTimeout(() => handlePreloaderComplete(), 2000);

    return () => {
      window.removeEventListener('preloaderComplete', handlePreloaderComplete);
      clearTimeout(timeout);
    };
  }, []);

  return (
    <section ref={containerRef} className="hero-section relative w-full h-[200vh]">
      <div className="hero-content sticky top-0 w-full h-screen pointer-events-none z-10 flex flex-col justify-between p-6 will-change-transform">
        
        {/* Top HUD */}
        <div className="flex justify-between items-start font-mono text-[10px] tracking-[0.2em] text-dim uppercase hud-element opacity-0">
          <div>
            SIH26161<br />
            NTRO<br />
            DISASTER MANAGEMENT
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            SYSTEM LIVE
          </div>
        </div>

        {/* Center Typography */}
        <div className="flex-1 flex flex-col justify-center max-w-[90vw] mx-auto w-full px-4 md:px-12">
          <div className="mb-2">
            <h1 className="hero-text-anim font-serif italic text-[clamp(4rem,11vw,12rem)] font-light tracking-tight leading-[0.8] text-white/90 drop-shadow-[0_0_30px_rgba(255,255,255,0.15)]">
              When dams fail,
            </h1>
          </div>
          <div>
            <h1 className="hero-text-anim font-sans text-[clamp(3rem,9vw,9rem)] font-bold tracking-tighter leading-[0.9] text-white uppercase drop-shadow-[0_0_30px_rgba(255,255,255,0.15)]">
              SECONDS DECIDE.
            </h1>
          </div>
          
          {/* Hero CTA - Solid Opacity and Stacked Layout */}
          <div className="mt-20 flex flex-col items-start pointer-events-auto opacity-0 hud-element">
            <a 
              href="/command"
              className="group cursor-hover flex items-center gap-4 transition-all duration-300 rounded-none shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_40px_rgba(245,158,11,0.6)]"
              style={{ backgroundColor: '#ffffff', color: '#000000', padding: '1.25rem 2rem', fontWeight: 600 }}
            >
              <span className="font-mono text-sm tracking-[0.2em]">ENTER COMMAND CENTER</span>
              <span className="group-hover:translate-x-1 transition-transform">&rarr;</span>
            </a>
            <div className="mt-8 ml-2">
              <a href="#" className="font-mono text-[11px] tracking-[0.3em] text-white/80 hover:text-white transition-colors cursor-hover uppercase block">
                Read the brief &rarr;
              </a>
            </div>
          </div>
        </div>

        {/* Scroll Cue */}
        <div className="flex justify-center hud-element opacity-0 pb-6">
          <div className="w-[1px] h-16 bg-gradient-to-b from-white/50 to-transparent" />
        </div>

      </div>
    </section>
  );
}
