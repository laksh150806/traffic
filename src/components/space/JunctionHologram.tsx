import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { RoadState } from "@/lib/traffic-types";
import { junctionAspects, type Aspect } from "@/lib/signal-aspect";
import { useFontsVersion, useSecondClock } from "@/components/space/useFontsReady";
import { makeGlowTexture, makeLabelTexture } from "@/components/space/label-texture";
import { GlCanvas } from "@/components/space/GlCanvas";

/** Hex mirrors of the signal tokens in styles.css. */
const GREEN = "#4ade80";
const RED = "#fb4d6a";
const AMBER = "#fbbf24";
const CAR = "#eceef2";
const HELD = "#5c5f66";
const LINE = "#d8dae0";
const STARK = "#e5484d";

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
  const car = (color: string, emissiveIntensity: number) =>
    new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity });
  const wire = (color: string, opacity: number) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
    });
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
    carGreen: car(CAR, 0.85),
    carRed: car(HELD, 0.12),
    edge: wire(LINE, 0.55),
    dash: wire(LINE, 0.28),
    ring: wire(LINE, 0.16),
    ringBright: wire(LINE, 0.34),
    stark: wire(STARK, 0.9),
    scan: wire(LINE, 0.22),
    plate: new THREE.MeshLambertMaterial({ color: "#101114", transparent: true, opacity: 0.75 }),
    lineGreen: flat(GREEN),
    lineRed: flat(RED),
    lineAmber: flat(AMBER),
    headGreen: flat(GREEN),
    headRed: flat(RED),
    headAmber: flat(AMBER),
    postMat: new THREE.MeshLambertMaterial({ color: "#3a3c42" }),
    haloGreen: halo(GREEN, 0.9),
    haloRed: halo(RED, 0.55),
    haloAmber: halo(AMBER, 0.8),
  };
}

type Assets = ReturnType<typeof buildAssets>;

function disposeAssets(assets: Assets) {
  for (const value of Object.values(assets)) value.dispose();
}

function Approach({
  road,
  aspect,
  reducedMotion,
  assets,
}: {
  road: RoadState;
  aspect: Aspect;
  reducedMotion: boolean;
  assets: Assets;
}) {
  const arm = ARM[road.direction];
  const cars = useRef<THREE.Group>(null);
  const head = useRef<THREE.Mesh>(null);
  const green = aspect === "GREEN";
  const lamp = aspect === "GREEN" ? "Green" : aspect === "AMBER" ? "Amber" : "Red";
  const count = Math.min(road.vehicle_count, MAX_CARS);
  const fonts = useFontsVersion();
  const label = useMemo(
    () =>
      makeLabelTexture([
        { text: `${arm?.label ?? ""}  ${road.vehicle_count}`, size: 14, weight: 600 },
      ]),
    // fonts: redraw once Manrope has loaded, so the label is not stuck in the fallback face.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arm?.label, road.vehicle_count, fonts],
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
        material={assets[`line${lamp}`]}
        scale={[0.92, 0.006, 0.05]}
        position={[0, 0.026, 0.62]}
      />

      {/* signal post and head */}
      <mesh geometry={assets.post} material={assets.postMat} position={[0.62, 0.22, 0.62]} />
      <mesh
        ref={head}
        geometry={assets.head}
        material={assets[`head${lamp}`]}
        position={[0.62, 0.46, 0.62]}
      />
      <sprite
        position={[0.62, 0.46, 0.62]}
        scale={[0.55, 0.55, 1]}
        material={assets[`halo${lamp}`]}
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
  const now = useSecondClock();
  const bearing = useRef<THREE.Group>(null);
  const scan = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (reducedMotion) return;
    const t = clock.elapsedTime;
    if (bearing.current) bearing.current.rotation.y = -t * 0.15;
    if (scan.current) {
      // A ring that spreads from the stop lines to the edge of the table and fades, every 4 s.
      const p = (t % 4) / 4;
      const r = 1 + p * 2.1;
      scan.current.scale.set(r, r, 1);
      scan.current.position.y = 0.03;
      (scan.current.material as THREE.MeshBasicMaterial).opacity = 0.3 * (1 - p);
    }
  });
  const aspects = useMemo(
    () =>
      junctionAspects(
        roads.map((r) => ({
          id: r.road_id,
          isGreen: r.is_currently_green,
          startedAtMs: r.phase_started_at ? Date.parse(r.phase_started_at) : 0,
        })),
        now,
      ),
    [roads, now],
  );

  return (
    <>
      <ambientLight intensity={0.7} color="#ffffff" />
      <directionalLight position={[3, 5, 2]} intensity={1.4} color="#ffffff" />

      {/* projection rings: the table the junction is projected onto */}
      {[1.25, 2.25, 3.2].map((r, i) => (
        <mesh
          key={r}
          rotation={[-Math.PI / 2, 0, 0]}
          material={i === 2 ? assets.ringBright : assets.ring}
        >
          <ringGeometry args={[r - 0.008, r + 0.008, 128]} />
        </mesh>
      ))}
      <group ref={bearing}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} material={assets.stark}>
          <ringGeometry args={[3.26, 3.32, 48, 1, 0, Math.PI / 7]} />
        </mesh>
        {Array.from({ length: 48 }, (_, i) => {
          const angle = (i / 48) * Math.PI * 2;
          const long = i % 12 === 0;
          return (
            <mesh
              key={i}
              geometry={assets.box}
              material={long ? assets.ringBright : assets.ring}
              rotation={[0, -angle, 0]}
              position={[Math.cos(angle) * 3.42, 0.002, Math.sin(angle) * 3.42]}
              scale={[long ? 0.22 : 0.1, 0.004, 0.012]}
            />
          );
        })}
      </group>
      <mesh ref={scan} rotation={[-Math.PI / 2, 0, 0]} material={assets.scan}>
        <ringGeometry args={[1.1, 1.13, 96]} />
      </mesh>

      {/* crossing roads: smoked glass with lit kerbs and a dashed centre line */}
      <mesh
        geometry={assets.box}
        material={assets.plate}
        scale={[6.2, 0.02, 1.05]}
        position={[0, 0.012, 0]}
      />
      <mesh
        geometry={assets.box}
        material={assets.plate}
        scale={[1.05, 0.02, 6.2]}
        position={[0, 0.012, 0]}
      />
      {[0, Math.PI / 2].map((turn) => (
        <group key={turn} rotation={[0, turn, 0]}>
          {[-1, 1].flatMap((side) =>
            [-1, 1].map((half) => (
              <mesh
                key={`${side}${half}`}
                geometry={assets.box}
                material={assets.edge}
                scale={[2.575, 0.004, 0.014]}
                position={[half * 1.8125, 0.026, side * 0.525]}
              />
            )),
          )}
          {Array.from({ length: 10 }, (_, i) => {
            const x = (i < 5 ? -1 : 1) * (0.78 + (i % 5) * 0.5);
            return (
              <mesh
                key={i}
                geometry={assets.box}
                material={assets.dash}
                scale={[0.22, 0.004, 0.012]}
                position={[x, 0.026, 0]}
              />
            );
          })}
        </group>
      ))}

      {roads.map((road) => (
        <Approach
          key={road.road_id}
          road={road}
          aspect={aspects.get(road.road_id) ?? "RED"}
          reducedMotion={reducedMotion}
          assets={assets}
        />
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
