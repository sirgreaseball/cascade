import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MeshDistortMaterial } from '@react-three/drei';
import * as THREE from 'three';


export default function LiquidBlob() {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<any>(null);
  const { pointer, viewport } = useThree();

  const targetRotation = useRef({ x: 0, y: 0 });

  useFrame((_state, delta) => {
    // Smoothly interpolate rotation towards pointer
    targetRotation.current.x = THREE.MathUtils.lerp(targetRotation.current.x, (pointer.y * Math.PI) / 4, 0.05);
    targetRotation.current.y = THREE.MathUtils.lerp(targetRotation.current.y, (pointer.x * Math.PI) / 4, 0.05);
    
    if (meshRef.current) {
      meshRef.current.rotation.x = targetRotation.current.x;
      meshRef.current.rotation.y = targetRotation.current.y;
      // Slow constant spin
      meshRef.current.rotation.z += delta * 0.2;
    }

    // Distort based on scroll velocity (we can read from lenis but standard scroll works too)
    // We'll just do a subtle breathing effect for now
    if (materialRef.current) {
      materialRef.current.distort = THREE.MathUtils.lerp(
        materialRef.current.distort,
        0.4 + Math.abs(pointer.x) * 0.2, // stretch slightly when mouse moves to edges
        0.1
      );
    }
  });

  return (
    <mesh ref={meshRef} position={[0, 0, 0]} scale={viewport.width / 4}>
      <icosahedronGeometry args={[1, 64]} />
      <MeshDistortMaterial
        ref={materialRef}
        color="#ffffff"
        transmission={1}
        transparent
        opacity={1}
        roughness={0.1}
        thickness={2}
        ior={1.5}
        envMapIntensity={2}
        distort={0.4}
        speed={2}
      />
    </mesh>
  );
}
