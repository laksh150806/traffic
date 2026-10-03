import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { RoadState } from "@/lib/traffic-types";
import { makeGlowTexture, makeLabelTexture } from "@/components/space/label-texture";
import { GlCanvas } from "@/components/space/GlCanvas";

/** Hex mirrors of the signal tokens in styles.css. */
const GREEN = "#4ade80";
const RED = "#fb4d6a";
const CAR = "#67e8f9";

const ARM: Record<string, { dir: [number, number]; label: string }> = {
  NORTH: { dir: [0, -1], label: "N" },
  SOUTH: { dir: [0, 1], label: "S" },
  EAST: { dir: [1, 0], label: "E" },
  WEST: { dir: [-1, 0], label: "W" },
};

const MAX_CARS = 18;
const LANE_OFFSET = 0.2;
const ROW_GAP = 0.26;
const FIRST_ROW = 0.82;

/** Built once and shared by every approach; per-car geometry is what makes scenes heavy. */
function buildAssets() {
  const glow = makeGlowTexture();
  const car = (emissiveIntensity: number) =>
    new THREE.MeshLambertMaterial({ color: CAR, emissive: CAR, emissiveIntensity });
  const flat = (color: string) => new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const halo = (color: string, opacity: number) =>
    new THREE.SpriteMaterial({
      map: glow,
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
  return {
    glow,
    box: new THREE.BoxGeometry(1, 1, 1),
    post: new THREE.CylinderGeometry(0.012, 0.012, 0.44, 8),
    head: new THREE.SphereGeometry(0.07, 16, 16),
    carGreen: car(0.7),
    carRed: car(0.35),
    lineGreen: flat(GREEN),
    lineRed: flat(RED),
    headGreen: flat(GREEN),
    headRed: flat(RED),
    postMat: new THREE.MeshLambertMaterial({ color: "#2a2d57" }),
    haloGreen: halo(GREEN, 0.9),
    haloRed: halo(RED, 0.55),
  };
}

type Assets = ReturnType<typeof buildAssets>;

function disposeAssets(assets: Assets) {
  for (const value of Object.values(assets)) value.dispose();
}

function Approach({
  road,
  reducedMotion,
  assets,
}: {
  road: RoadState;
  reducedMotion: boolean;
  assets: Assets;
}) {
  const arm = ARM[road.direction];
  const cars = useRef<THREE.Group>(null);
  const head = useRef<THREE.Mesh>(null);
  const green = road.is_currently_green;
  const count = Math.min(road.vehicle_count, MAX_CARS);
  const label = useMemo(
    () =>
      makeLabelTexture([
        { text: `${arm?.label ?? ""}  ${road.vehicle_count}`, size: 14, weight: 600 },
      ]),
    [arm?.label, road.vehicle_count],
  );
  useEffect(() => () => label.texture.dispose(), [label]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (head.current) {
      const pulse = green && !reducedMotion ? 1 + Math.sin(t * 4) * 0.12 : 1;
      head.current.scale.setScalar(pulse);
    }
    if (cars.current && !reducedMotion) {
      // On green the queue creeps toward the junction; on red it holds still.
      const creep = green ? (Math.sin(t * 2.4) * 0.5 + 0.5) * 0.12 : 0;
      cars.current.position.set(0, 0, -creep);
    }
  });

  if (!arm) return null;
  const [dx, dz] = arm.dir;
  // Rotate the arm's local +Z (away from centre) onto the compass direction.
  const yaw = Math.atan2(dx, dz);

  return (
    <group rotation={[0, yaw, 0]}>
      <group ref={cars}>
        {Array.from({ length: count }).map((_, i) => {
          const row = Math.floor(i / 2);
          const lane = i % 2 === 0 ? LANE_OFFSET : -LANE_OFFSET;
          return (
            <mesh
              key={i}
              geometry={assets.box}
              material={green ? assets.carGreen : assets.carRed}
              scale={[0.15, 0.09, 0.25]}
              position={[lane, 0.07, FIRST_ROW + row * ROW_GAP]}
            />
          );
        })}
      </group>

      {/* stop line */}
      <mesh
        geometry={assets.box}
        material={green ? assets.lineGreen : assets.lineRed}
        scale={[0.92, 0.006, 0.05]}
        position={[0, 0.026, 0.62]}
      />

      {/* signal post and head */}
      <mesh geometry={assets.post} material={assets.postMat} position={[0.62, 0.22, 0.62]} />
      <mesh
        ref={head}
        geometry={assets.head}
        material={green ? assets.headGreen : assets.headRed}
        position={[0.62, 0.46, 0.62]}
      />
      <sprite
        position={[0.62, 0.46, 0.62]}
        scale={[0.55, 0.55, 1]}
        material={green ? assets.haloGreen : assets.haloRed}
        raycast={() => null}
      />

      <sprite
        position={[0, 0.3, FIRST_ROW + 5.9 * ROW_GAP]}
        scale={[label.cssWidth * 0.0085, label.cssHeight * 0.0085, 1]}
        renderOrder={10}
        raycast={() => null}
      >
        <spriteMaterial map={label.texture} transparent depthTest={false} toneMapped={false} />
      </sprite>
    </group>
  );
}

function Scene({ roads, reducedMotion }: { roads: RoadState[]; reducedMotion: boolean }) {
  const assets = useMemo(buildAssets, []);
  useEffect(() => () => disposeAssets(assets), [assets]);

  return (
    <>
      <ambientLight intensity={0.8} color="#8c8cff" />
      <directionalLight position={[3, 5, 2]} intensity={1.6} color="#dfeeff" />

      {/* ground disc and grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[3.3, 56]} />
        <meshBasicMaterial color="#0c1038" transparent opacity={0.85} />
      </mesh>
      <gridHelper args={[6.6, 22, "#4a5bd6", "#222a73"]} position={[0, 0.001, 0]} />

      {/* crossing roads */}
      <mesh geometry={assets.box} scale={[6.2, 0.02, 1.05]} position={[0, 0.012, 0]}>
        <meshLambertMaterial color="#181c4c" />
      </mesh>
      <mesh geometry={assets.box} scale={[1.05, 0.02, 6.2]} position={[0, 0.012, 0]}>
        <meshLambertMaterial color="#181c4c" />
      </mesh>
      <mesh geometry={assets.box} scale={[1.05, 0.006, 1.05]} position={[0, 0.024, 0]}>
        <meshLambertMaterial color="#232a6e" emissive="#3b4ae0" emissiveIntensity={0.25} />
      </mesh>

      {roads.map((road) => (
        <Approach key={road.road_id} road={road} reducedMotion={reducedMotion} assets={assets} />
      ))}

      <OrbitControls
        enablePan={false}
        enableZoom={false}
        autoRotate={!reducedMotion}
        autoRotateSpeed={0.6}
        minPolarAngle={Math.PI * 0.18}
        maxPolarAngle={Math.PI * 0.42}
      />
    </>
  );
}

function Unavailable() {
  return (
    <div className="flex h-full w-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
      The 3D junction preview is switched off on this device. The approach cards below carry the
      same numbers.
    </div>
  );
}

export default function JunctionHologram({
  roads,
  reducedMotion,
}: {
  roads: RoadState[];
  reducedMotion: boolean;
}) {
  return (
    <GlCanvas
      camera={{ position: [4.6, 3.9, 5.2], fov: 36 }}
      fallback={<Unavailable />}
      fps={24}
      antialias={false}
    >
      <Scene roads={roads} reducedMotion={reducedMotion} />
    </GlCanvas>
  );
}
