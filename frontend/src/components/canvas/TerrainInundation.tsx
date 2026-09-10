import { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const terrainVertexShader = `
  varying vec2 vUv;
  varying float vElevation;
  uniform float uTime;
  
  // Simplex 2D noise
  vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
  float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
             -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
    + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
      dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    vUv = uv;
    vec3 pos = position;
    
    // Generate terrain elevation
    float elevation = snoise(pos.xy * 0.1) * 2.0;
    elevation += snoise(pos.xy * 0.3) * 0.5;
    
    pos.z += elevation;
    vElevation = elevation;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const terrainFragmentShader = `
  varying vec2 vUv;
  varying float vElevation;
  
  void main() {
    // Topographic wireframe/contour effect
    float line = fract(vElevation * 4.0);
    float alpha = smoothstep(0.0, 0.05, line) * smoothstep(1.0, 0.95, line);
    
    // Wireframe base color
    vec3 baseColor = vec3(0.05, 0.05, 0.05);
    vec3 lineColor = vec3(0.2, 0.2, 0.2);
    
    vec3 finalColor = mix(lineColor, baseColor, alpha);
    
    // Fade out edges
    float dist = distance(vUv, vec2(0.5));
    float edgeFade = smoothstep(0.5, 0.2, dist);
    
    gl_FragColor = vec4(finalColor, edgeFade);
  }
`;

const waterVertexShader = `
  varying vec2 vUv;
  uniform float uTime;
  
  void main() {
    vUv = uv;
    vec3 pos = position;
    // Gentle water ripple
    pos.z += sin(pos.x * 2.0 + uTime) * 0.1;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const waterFragmentShader = `
  varying vec2 vUv;
  uniform float uFloodLevel;
  
  void main() {
    // Water gradient #38bdf8 to #0c4a6e
    vec3 colorTop = vec3(0.22, 0.74, 0.97); // 38bdf8
    vec3 colorBottom = vec3(0.05, 0.29, 0.43); // 0c4a6e
    
    vec3 finalColor = mix(colorBottom, colorTop, vUv.y);
    
    // Only render water up to the flood level
    float alpha = 0.8;
    
    gl_FragColor = vec4(finalColor, alpha);
  }
`;

export default function TerrainInundation() {
  const { camera } = useThree();
  const waterUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uFloodLevel: { value: 0 } // 0 to 1
  }), []);

  const terrainUniforms = useMemo(() => ({
    uTime: { value: 0 }
  }), []);

  const groupRef = useRef<THREE.Group>(null);
  const waterRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    // Camera Choreography scrubbed by scroll
    // The hero section needs an ID or class to bind to. We'll assume '.hero-section' exists in App
    const ctx = gsap.context(() => {
      // Start camera orthographic-ish (top down)
      camera.position.set(0, 0, 15);
      camera.rotation.set(0, 0, 0);

      // Scroll timeline
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: '.hero-section',
          start: 'top top',
          end: 'bottom top',
          scrub: 1, // 1 second smoothing
        }
      });

      // Camera descends and tilts into valley
      tl.to(camera.position, {
        y: -10,
        z: 3,
        ease: 'power2.inOut',
      }, 0);

      tl.to(camera.rotation, {
        x: Math.PI / 3,
        ease: 'power2.inOut',
      }, 0);

      // Water rises
      tl.to(waterRef.current!.position, {
        z: 1.5, // Rise in Z axis
        ease: 'none',
      }, 0);
      
    });

    return () => ctx.revert();
  }, [camera]);

  useFrame((_state, delta) => {
    waterUniforms.uTime.value += delta;
    terrainUniforms.uTime.value += delta;
  });

  return (
    <group ref={groupRef} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Procedural Terrain */}
      <mesh>
        <planeGeometry args={[40, 40, 128, 128]} />
        <shaderMaterial 
          vertexShader={terrainVertexShader}
          fragmentShader={terrainFragmentShader}
          uniforms={terrainUniforms}
          transparent
          wireframe={false}
          depthWrite={false}
        />
      </mesh>

      {/* Water Surface */}
      <mesh ref={waterRef} position={[0, 0, -2]}>
        <planeGeometry args={[40, 40, 32, 32]} />
        <shaderMaterial
          vertexShader={waterVertexShader}
          fragmentShader={waterFragmentShader}
          uniforms={waterUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}
