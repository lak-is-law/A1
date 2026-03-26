"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";

type Shard = {
  pos: [number, number, number];
  rot: [number, number, number];
  scale: number;
  hueOffset: number;
};

function mulberry32(seed: number) {
  // Deterministic PRNG so the component stays pure for React renders.
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ShardField({ intensity, active }: { intensity: number; active: boolean }) {
  const groupRef = useRef<THREE.Group | null>(null);

  const shards = useMemo<Shard[]>(() => {
    const out: Shard[] = [];
    const count = 42;
    const rng = mulberry32(1337);
    for (let i = 0; i < count; i++) {
      const r = rng();
      const radius = 1.2 + rng() * 1.7;
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos(2 * rng() - 1);
      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.cos(phi);
      const z = radius * Math.sin(phi) * Math.sin(theta);
      out.push({
        pos: [x, y, z],
        rot: [rng() * Math.PI, rng() * Math.PI, rng() * Math.PI],
        scale: 0.12 + rng() * 0.38,
        hueOffset: r,
      });
    }
    return out;
  }, []);

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;
    const t = state.clock.getElapsedTime();

    const base = active ? 1 : 0.15;
    const spin = (active ? 0.55 : 0.18) * base * intensity;
    g.rotation.x = spin * Math.sin(t * 0.55);
    g.rotation.y = t * 0.22 * spin;
    g.rotation.z = spin * Math.cos(t * 0.33);

    // Slow breathing so it feels alive even when "inactive".
    const s = 1 + (active ? 0.12 : 0.04) * Math.sin(t * 1.4);
    g.scale.setScalar(s);
  });

  return (
    <group ref={groupRef}>
      {shards.map((s, idx) => (
        <mesh
          key={idx}
          position={s.pos}
          rotation={s.rot}
          scale={s.scale}
          castShadow={false}
          receiveShadow={false}
        >
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial
            color={new THREE.Color().setHSL(0.02 + s.hueOffset * 0.8, 0.9, 0.6)}
            emissive={new THREE.Color().setHSL(0.01 + s.hueOffset * 0.8, 1, 0.45)}
            emissiveIntensity={0.9 * intensity}
            roughness={0.25}
            metalness={0.65}
            transparent
            opacity={active ? 0.9 : 0.55}
          />
        </mesh>
      ))}
    </group>
  );
}

export function AiThinkingCanvas({ active, intensity = 1 }: { active: boolean; intensity?: number }) {
  // Canvas must be isolated to keep layout stable.
  return (
    <div className="relative h-[240px] w-full overflow-hidden rounded-3xl rb-glass">
      <Canvas
        dpr={[1, 1.6]}
        camera={{ position: [0, 0.2, 4.2], fov: 35 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["transparent"]} />
        <ambientLight intensity={0.35} />
        <pointLight position={[2.5, 2.5, 2]} intensity={1.35 * intensity} />
        <pointLight position={[-2.5, -2.5, -2]} intensity={0.8 * intensity} />
        <Suspense fallback={null}>
          <ShardField active={active} intensity={active ? intensity : Math.max(0.3, intensity * 0.6)} />
        </Suspense>
      </Canvas>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,42,42,0.18),transparent_55%)]" />
    </div>
  );
}

