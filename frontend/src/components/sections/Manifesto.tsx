import { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// 2D Background Particles (WebGL is behind this, so these are DOM or we can make a small local Canvas)
// Wait, the prompt said "Background: instanced particle drift (~2000 pts, GPU)".
// We can just add them to the main Canvas since the Canvas is fixed in the background!
// I'll create a component for the particles and export it.

export function ManifestoParticles() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const particleCount = 2000;
  
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const particles = useMemo(() => {
    const temp = [];
    for (let i = 0; i < particleCount; i++) {
      temp.push({
        x: (Math.random() - 0.5) * 40,
        y: (Math.random() - 0.5) * 40 - 20, // Lower down for manifesto section
        z: (Math.random() - 0.5) * 10,
        speed: Math.random() * 0.02,
      });
    }
    return temp;
  }, []);

  useFrame(() => {
    if (!meshRef.current) return;
    particles.forEach((particle, i) => {
      particle.y += particle.speed;
      if (particle.y > 10) particle.y = -30;
      dummy.position.set(particle.x, particle.y, particle.z);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, particleCount]}>
      <circleGeometry args={[0.02, 8]} />
      <meshBasicMaterial color="#f2f2f2" transparent opacity={0.3} />
    </instancedMesh>
  );
}

export default function Manifesto() {
  const containerRef = useRef<HTMLDivElement>(null);

  const text = "A dam break releases millions of cubic metres in minutes. CASCADE simulates the inundation in the browser — terrain, water, infrastructure, lives — before the water arrives.";
  const words = text.split(' ');

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('.manifesto-word', 
        { opacity: 0.1, y: 10 },
        {
          opacity: 1,
          y: 0,
          stagger: 0.05,
          ease: 'none',
          scrollTrigger: {
            trigger: containerRef.current,
            start: 'top center',
            end: 'bottom center',
            scrub: true,
          }
        }
      );
    }, containerRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} className="relative w-full min-h-[150vh] flex items-center justify-center px-4 md:px-20 z-10 pointer-events-none">
      <div className="max-w-5xl mx-auto text-center mix-blend-difference">
        <h2 className="font-sans text-3xl md:text-5xl lg:text-7xl font-semibold tracking-tight leading-tight text-ink flex flex-wrap justify-center gap-[0.25em]">
          {words.map((word, i) => (
            <span key={i} className="manifesto-word inline-block">{word}</span>
          ))}
        </h2>
      </div>
    </section>
  );
}
