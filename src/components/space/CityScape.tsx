import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { nearestLinks, planeFrameFor, toPlane } from "@/lib/map-plane";
import { makeGlowTexture, makeLabelTexture } from "@/components/space/label-texture";
import { GlCanvas, type GlFailReason } from "@/components/space/GlCanvas";
import type { JunctionSummary } from "@/lib/traffic-types";

/**
 * The network as a glass city: every junction is a column whose height and
 * colour show congestion, linked to its neighbours by light. WebGL needs hex, so
 * these mirror the signal tokens in styles.css.
 *
 * Geometry and materials are built once and shared by all 69 columns. Creating
 * them per column multiplies GPU memory and shader state for no visual gain.
 */
const LEVEL_HEX: Record<string, string> = {
  LOW: "#4ade80",
  MODERATE: "#fbbf24",
  HIGH: "#fb4d6a",
};

const CITY_SIZE = 7;
const BASE_Y = 0.1;

type Props = {
  junctions: JunctionSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  reducedMotion: boolean;
  fallback: ReactNode;
  onFail?: (reason: GlFailReason) => void;
};

type LevelAssets = {
  core: THREE.MeshBasicMaterial;
  cap: THREE.MeshBasicMaterial;
  beam: THREE.MeshBasicMaterial;
  floor: { rest: THREE.SpriteMaterial; selected: THREE.SpriteMaterial };
};

type Assets = {
  box: THREE.BoxGeometry;
  ring: THREE.RingGeometry;
  beam: THREE.CylinderGeometry;
  shell: { rest: THREE.MeshStandardMaterial; selected: THREE.MeshStandardMaterial };
  hit: THREE.MeshBasicMaterial;
  levels: Record<string, LevelAssets>;
};

function buildAssets(glow: THREE.Texture): Assets {
  const levels: Record<string, LevelAssets> = {};
  for (const [level, hex] of Object.entries(LEVEL_HEX)) {
    const floor = (opacity: number) =>
      new THREE.SpriteMaterial({
        map: glow,
        color: hex,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
    levels[level] = {
      core: new THREE.MeshBasicMaterial({
        color: hex,
        transparent: true,
        opacity: 0.92,
        toneMapped: false,
      }),
      cap: new THREE.MeshBasicMaterial({ color: hex, toneMapped: false }),
      beam: new THREE.MeshBasicMaterial({
        color: hex,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
      floor: { rest: floor(0.45), selected: floor(0.75) },
    };
  }
  const shell = (opacity: number) =>
    new THREE.MeshStandardMaterial({
      color: "#cfe3ff",
      transparent: true,
      opacity,
      roughness: 0.1,
      metalness: 0,
    });
  return {
    box: new THREE.BoxGeometry(1, 1, 1),
    ring: new THREE.RingGeometry(0.07, 0.085, 32),
    beam: new THREE.CylinderGeometry(0.008, 0.05, 4, 12, 1, true),
    shell: { rest: shell(0.22), selected: shell(0.34) },
    hit: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    levels,
  };
}

function disposeAssets(assets: Assets) {
  assets.box.dispose();
  assets.ring.dispose();
  assets.beam.dispose();
  assets.shell.rest.dispose();
  assets.shell.selected.dispose();
  assets.hit.dispose();
  for (const level of Object.values(assets.levels)) {
    level.core.dispose();
    level.cap.dispose();
    level.beam.dispose();
    level.floor.rest.dispose();
    level.floor.selected.dispose();
  }
}

type ColumnProps = {
  junction: JunctionSummary;
  x: number;
  z: number;
  selected: boolean;
  assets: Assets;
  onSelect: (id: number) => void;
  onHover: (id: number | null) => void;
  reducedMotion: boolean;
};

/** Column height in scene units for a junction's average queue. */
function columnHeight(junction: JunctionSummary) {
  return 0.16 + Math.min(1, junction.avg_vehicle_count / 70) * 1.0;
}

function Column({
  junction,
  x,
  z,
  selected,
  assets,
  onSelect,
  onHover,
  reducedMotion,
}: ColumnProps) {
  const shell = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const cap = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const height = useRef(0.1);

  const level = junction.congestion_level in LEVEL_HEX ? junction.congestion_level : "LOW";
  const look = assets.levels[level] as LevelAssets;
  const color = LEVEL_HEX[level] ?? "#4ade80";
  const target = columnHeight(junction);
  const width = selected ? 0.15 : 0.1;
  const speed = level === "HIGH" ? 2.6 : level === "MODERATE" ? 1.6 : 1;

  useFrame(({ clock }, delta) => {
    const ease = reducedMotion ? 1 : 1 - Math.exp(-5 * delta);
    height.current += (target - height.current) * ease;
    const h = height.current;
    if (shell.current) {
      shell.current.scale.set(width, h, width);
      shell.current.position.y = BASE_Y + h / 2;
    }
    if (core.current) {
      core.current.scale.set(width * 0.42, h * 0.96, width * 0.42);
      core.current.position.y = BASE_Y + (h * 0.96) / 2;
    }
    if (cap.current) {
      cap.current.scale.set(width * 0.9, 0.022, width * 0.9);
      cap.current.position.y = BASE_Y + h + 0.012;
    }
    if (ring.current) {
      const phase = reducedMotion
        ? 0.4
        : (clock.elapsedTime * speed + junction.junction_id * 0.37) % 1;
      ring.current.scale.setScalar(1 + phase * (selected ? 3.2 : 2));
      (ring.current.material as THREE.MeshBasicMaterial).opacity =
        (1 - phase) * (selected ? 0.8 : 0.45);
    }
  });

  const floorSize = selected ? 1.5 : 0.95;

  return (
    <group position={[x, 0, z]}>
      {/* floor glow */}
      <sprite
        position={[0, BASE_Y + 0.01, 0]}
        scale={[floorSize, floorSize, 1]}
        material={selected ? look.floor.selected : look.floor.rest}
        raycast={() => null}
      />
      <mesh
        ref={ring}
        geometry={assets.ring}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, BASE_Y + 0.012, 0]}
        raycast={() => null}
      >
        <meshBasicMaterial color={color} transparent depthWrite={false} toneMapped={false} />
      </mesh>

      {/* glass shell with a glowing core */}
      <mesh
        ref={shell}
        geometry={assets.box}
        material={selected ? assets.shell.selected : assets.shell.rest}
        raycast={() => null}
      />
      <mesh ref={core} geometry={assets.box} material={look.core} raycast={() => null} />
      <mesh ref={cap} geometry={assets.box} material={look.cap} raycast={() => null} />

      {selected ? (
        <mesh
          position={[0, 2.2, 0]}
          geometry={assets.beam}
          material={look.beam}
          raycast={() => null}
        />
      ) : null}

      {/* generous invisible hit target */}
      <mesh
        position={[0, 0.5, 0]}
        scale={[0.34, 1.2, 0.34]}
        geometry={assets.box}
        material={assets.hit}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(junction.junction_id);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          onHover(junction.junction_id);
        }}
        onPointerOut={() => onHover(null)}
      />
    </group>
  );
}

/** One glass label that follows the hovered (else selected) junction. */
function JunctionLabel({
  junction,
  x,
  z,
}: {
  junction: JunctionSummary | null;
  x: number;
  z: number;
}) {
  const name = junction?.name;
  const zone = junction?.zone;
  const average = junction?.avg_vehicle_count;
  const label = useMemo(() => {
    if (name === undefined) return null;
    return makeLabelTexture([
      { text: name, size: 15, weight: 600 },
      { text: `${zone}, avg ${average} vehicles`, size: 12, color: "#aab4e8" },
    ]);
  }, [name, zone, average]);

  useEffect(() => () => label?.texture.dispose(), [label]);

  if (!junction || !label) return null;
  const height = BASE_Y + columnHeight(junction) + 0.42;
  const unit = 0.0105;
  return (
    <sprite
      position={[x, height, z]}
      scale={[label.cssWidth * unit, label.cssHeight * unit, 1]}
      renderOrder={10}
      raycast={() => null}
    >
      <spriteMaterial map={label.texture} transparent depthTest={false} toneMapped={false} />
    </sprite>
  );
}

/** Slides the orbit target (and the camera with it) onto the selected junction. */
function FocusRig({ target, reducedMotion }: { target: THREE.Vector3; reducedMotion: boolean }) {
  const controls = useThree((state) => state.controls) as unknown as {
    target: THREE.Vector3;
  } | null;
  const camera = useThree((state) => state.camera);
  const step = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    if (!controls) return;
    const ease = reducedMotion ? 1 : 1 - Math.exp(-3.4 * delta);
    step.copy(target).sub(controls.target).multiplyScalar(ease);
    controls.target.add(step);
    camera.position.add(step);
  });
  return null;
}

/** A handful of slow motes so the space above the city never feels dead. */
function Motes({ reducedMotion, glow }: { reducedMotion: boolean; glow: THREE.Texture }) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(120 * 3);
    for (let i = 0; i < 120; i += 1) {
      arr[i * 3] = (Math.random() - 0.5) * 12;
      arr[i * 3 + 1] = Math.random() * 4.5;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }
    return arr;
  }, []);

  useFrame((_, delta) => {
    if (points.current && !reducedMotion) points.current.rotation.y += delta * 0.01;
  });

  return (
    <points ref={points} raycast={() => null}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={glow}
        size={0.09}
        color="#b5c7ff"
        transparent
        opacity={0.55}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  );
}

type SceneProps = Pick<Props, "junctions" | "selectedId" | "onSelect" | "reducedMotion">;

function City({ junctions, selectedId, onSelect, reducedMotion }: SceneProps) {
  const glow = useMemo(makeGlowTexture, []);
  const assets = useMemo(() => buildAssets(glow), [glow]);
  const slabEdges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(CITY_SIZE + 2.6, 0.2, CITY_SIZE + 2.6)),
    [],
  );
  useEffect(
    () => () => {
      disposeAssets(assets);
      glow.dispose();
      slabEdges.dispose();
    },
    [assets, glow, slabEdges],
  );

  // Positions only depend on where the junctions are, not on their live counts, so
  // the network layout is rebuilt only when that set actually changes.
  const layoutKey = junctions.map((j) => `${j.junction_id}:${j.latitude}:${j.longitude}`).join("|");
  const points = useMemo(
    () => junctions.map((j) => ({ lat: j.latitude, lng: j.longitude })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutKey],
  );
  const frame = useMemo(() => planeFrameFor(points, CITY_SIZE), [points]);
  const spots = useMemo(() => points.map((p) => toPlane(p, frame)), [points, frame]);
  const links = useMemo(() => nearestLinks(spots, 2, 1.7), [spots]);
  const [hoverId, setHoverId] = useState<number | null>(null);

  useEffect(() => {
    document.body.style.cursor = hoverId === null ? "auto" : "pointer";
    return () => {
      document.body.style.cursor = "auto";
    };
  }, [hoverId]);

  const selectedIndex = junctions.findIndex((j) => j.junction_id === selectedId);
  const labelId = hoverId ?? selectedId;
  const labelIndex = junctions.findIndex((j) => j.junction_id === labelId);

  const linkGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const data = new Float32Array(links.length * 6);
    links.forEach(([a, b], i) => {
      const pa = spots[a];
      const pb = spots[b];
      if (!pa || !pb) return;
      data.set([pa[0], BASE_Y + 0.02, pa[1], pb[0], BASE_Y + 0.02, pb[1]], i * 6);
    });
    geometry.setAttribute("position", new THREE.BufferAttribute(data, 3));
    return geometry;
  }, [links, spots]);

  const activeGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const touching = links.filter(([a, b]) => a === selectedIndex || b === selectedIndex);
    const data = new Float32Array(touching.length * 6);
    touching.forEach(([a, b], i) => {
      const pa = spots[a];
      const pb = spots[b];
      if (!pa || !pb) return;
      data.set([pa[0], BASE_Y + 0.03, pa[1], pb[0], BASE_Y + 0.03, pb[1]], i * 6);
    });
    geometry.setAttribute("position", new THREE.BufferAttribute(data, 3));
    return geometry;
  }, [links, spots, selectedIndex]);

  useEffect(
    () => () => {
      linkGeometry.dispose();
      activeGeometry.dispose();
    },
    [linkGeometry, activeGeometry],
  );

  const focus = useMemo(() => {
    const spot = spots[selectedIndex];
    return new THREE.Vector3(spot?.[0] ?? 0, 0.4, spot?.[1] ?? 0);
  }, [spots, selectedIndex]);

  return (
    <>
      {/* glass slab the city stands on */}
      <mesh position={[0, 0.0, 0]} raycast={() => null}>
        <boxGeometry args={[CITY_SIZE + 2.6, 0.2, CITY_SIZE + 2.6]} />
        <meshStandardMaterial color="#9db4ff" transparent opacity={0.14} roughness={0.08} />
      </mesh>
      <lineSegments geometry={slabEdges} raycast={() => null}>
        <lineBasicMaterial color="#8fb2ff" transparent opacity={0.35} toneMapped={false} />
      </lineSegments>

      <Grid
        position={[0, 0.101, 0]}
        args={[CITY_SIZE + 2.4, CITY_SIZE + 2.4]}
        cellSize={0.5}
        cellThickness={0.6}
        cellColor="#3d4fd0"
        sectionSize={2.5}
        sectionThickness={1.1}
        sectionColor="#7c8cff"
        fadeDistance={14}
        fadeStrength={1.6}
        followCamera={false}
        infiniteGrid={false}
      />

      <lineSegments geometry={linkGeometry} raycast={() => null}>
        <lineBasicMaterial color="#7dd3fc" transparent opacity={0.28} toneMapped={false} />
      </lineSegments>
      <lineSegments geometry={activeGeometry} raycast={() => null}>
        <lineBasicMaterial color="#e0f2ff" transparent opacity={0.95} toneMapped={false} />
      </lineSegments>

      {junctions.map((junction, i) => {
        const spot = spots[i];
        if (!spot) return null;
        return (
          <Column
            key={junction.junction_id}
            junction={junction}
            x={spot[0]}
            z={spot[1]}
            selected={junction.junction_id === selectedId}
            assets={assets}
            onSelect={onSelect}
            onHover={setHoverId}
            reducedMotion={reducedMotion}
          />
        );
      })}

      <JunctionLabel
        junction={labelIndex >= 0 ? (junctions[labelIndex] ?? null) : null}
        x={spots[labelIndex]?.[0] ?? 0}
        z={spots[labelIndex]?.[1] ?? 0}
      />

      <Motes reducedMotion={reducedMotion} glow={glow} />
      <FocusRig target={focus} reducedMotion={reducedMotion} />
    </>
  );
}

export default function CityScape({ fallback, onFail, ...scene }: Props) {
  return (
    <GlCanvas
      camera={{ position: [0, 6.4, 8.2], fov: 38 }}
      fallback={fallback}
      {...(onFail ? { onFail } : {})}
    >
      <fog attach="fog" args={["#0c0a24", 11, 26]} />
      <ambientLight intensity={0.8} color="#8a8cff" />
      <directionalLight position={[4, 8, 3]} intensity={2} color="#e3efff" />
      <pointLight position={[-5, 3, -4]} intensity={30} color="#8b5cf6" distance={18} />
      <pointLight position={[5, 2.5, 5]} intensity={22} color="#22d3ee" distance={16} />
      <City {...scene} />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.5}
        minDistance={4}
        maxDistance={13}
        minPolarAngle={Math.PI * 0.12}
        maxPolarAngle={Math.PI * 0.42}
        minAzimuthAngle={-1.1}
        maxAzimuthAngle={1.1}
      />
    </GlCanvas>
  );
}
