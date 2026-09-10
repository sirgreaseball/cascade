import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';


const PARTICLE_COUNT = 15000;

const vertexShader = `
  uniform float uTime;
  uniform float uScroll;
  attribute float size;
  attribute vec3 randomOffset;
  
  varying vec2 vUv;
  varying float vDepth;
  
  void main() {
    vUv = uv;
    vec3 pos = position;
    
    // Noise/fluid displacement based on time and scroll
    float noise = sin(pos.x * 2.0 + uTime) * cos(pos.y * 2.0 + uTime) * 0.5;
    
    // Scroll effect (morphing)
    pos.y += uScroll * 10.0; // move particles up as we scroll down
    // Wrap particles around
    if (pos.y > 10.0) pos.y -= 20.0;
    
    pos.z += noise + randomOffset.z * 2.0;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    vDepth = -mvPosition.z;
    
    // Size attenuation
    gl_PointSize = size * (10.0 / -mvPosition.z);
  }
`;

const fragmentShader = `
  varying vec2 vUv;
  varying float vDepth;
  
  void main() {
    // Soft circular particle
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    
    float alpha = smoothstep(0.5, 0.1, dist);
    
    // Depth coloring (cyan to deep blue)
    vec3 color1 = vec3(0.03, 0.53, 0.82); // bright cyan
    vec3 color2 = vec3(0.01, 0.15, 0.35); // dark blue
    
    float depthFactor = smoothstep(5.0, 15.0, vDepth);
    vec3 finalColor = mix(color1, color2, depthFactor);
    
    gl_FragColor = vec4(finalColor, alpha * 0.6);
  }
`;

export default function FluidParticles() {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  
  const [positions, sizes, randomOffsets] = useMemo(() => {
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const size = new Float32Array(PARTICLE_COUNT);
    const offsets = new Float32Array(PARTICLE_COUNT * 3);
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30; // x
      pos[i * 3 + 1] = (Math.random() - 0.5) * 20; // y
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10 - 5; // z
      
      size[i] = Math.random() * 8.0 + 2.0;
      
      offsets[i * 3] = Math.random();
      offsets[i * 3 + 1] = Math.random();
      offsets[i * 3 + 2] = Math.random();
    }
    
    return [pos, size, offsets];
  }, []);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uScroll: { value: 0 }
  }), []);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime * 0.5;
      
      const scrollY = window.scrollY / (document.body.scrollHeight - window.innerHeight || 1);
      
      materialRef.current.uniforms.uScroll.value = THREE.MathUtils.lerp(
        materialRef.current.uniforms.uScroll.value,
        scrollY,
        0.05
      );
    }
    
    if (pointsRef.current) {
      pointsRef.current.rotation.y = state.clock.elapsedTime * 0.05;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
        <bufferAttribute attach="attributes-randomOffset" args={[randomOffsets, 3]} />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent={true}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
