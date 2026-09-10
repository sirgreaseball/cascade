import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Preload } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, Noise, ChromaticAberration } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import TerrainInundation from './TerrainInundation';
import { ManifestoParticles } from '../sections/Manifesto';

function AdaptiveQuality() {
  return null;
}

export default function Scene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 15], fov: 45 }}
      gl={{ 
        antialias: false,
        powerPreference: 'high-performance',
        alpha: false 
      }}
      dpr={[1, 1.75]}
      onCreated={({ gl, scene }) => {
        scene.background = new THREE.Color('#050505');
        gl.setClearColor('#050505');
      }}
    >
      <AdaptiveQuality />
      <ambientLight intensity={0.5} />
      
      <Suspense fallback={null}>
        <TerrainInundation />
        <ManifestoParticles />
        <Preload all />
      </Suspense>

      <EffectComposer multisampling={0}>
        <Noise opacity={0.05} blendFunction={BlendFunction.OVERLAY} />
        <Vignette eskil={false} offset={0.1} darkness={1.1} />
        <Bloom 
          luminanceThreshold={0.2} 
          mipmapBlur 
          intensity={0.5} 
        />
        <ChromaticAberration 
          offset={new THREE.Vector2(0.001, 0.001)} 
          blendFunction={BlendFunction.NORMAL} 
        />
      </EffectComposer>
    </Canvas>
  );
}
