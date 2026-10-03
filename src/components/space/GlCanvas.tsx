import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";

export type GlFailReason = "unsupported" | "error" | "context-lost" | "slow";

let supportCache: boolean | null = null;

/** True when this browser can give us a real hardware WebGL context. */
export function webglSupported() {
  if (supportCache !== null) return supportCache;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ??
      canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true });
    supportCache = Boolean(gl);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    supportCache = false;
  }
  return supportCache;
}

class Boundary extends Component<
  { onError: (error: Error) => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Renders on a timer instead of every display frame, and only while the canvas
 * is on screen and the tab is visible. It also watches the real frame rate: if
 * the GPU cannot keep up it asks the parent to back off before the page stalls.
 */
function Pacer({ fps, onSlow }: { fps: number; onSlow: () => void }) {
  const invalidate = useThree((state) => state.invalidate);
  const element = useThree((state) => state.gl.domElement);
  const rendered = useRef(0);
  const onScreen = useRef(true);

  useFrame(() => {
    rendered.current += 1;
  });

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      onScreen.current = entry?.isIntersecting ?? true;
    });
    observer.observe(element);

    let slowWindows = 0;
    let last = performance.now();
    const pulse = window.setInterval(() => {
      if (onScreen.current && !document.hidden) invalidate();
    }, 1000 / fps);
    const watch = window.setInterval(() => {
      const now = performance.now();
      const rate = (rendered.current * 1000) / (now - last);
      rendered.current = 0;
      last = now;
      // rate 0 means the page is not being painted at all (covered or hidden), not that it is slow.
      const struggling = onScreen.current && !document.hidden && rate > 0 && rate < fps * 0.4;
      slowWindows = struggling ? slowWindows + 1 : 0;
      if (slowWindows >= 3) {
        slowWindows = 0;
        onSlow();
      }
    }, 2000);

    return () => {
      observer.disconnect();
      window.clearInterval(pulse);
      window.clearInterval(watch);
    };
  }, [element, fps, invalidate, onSlow]);

  return null;
}

type Props = {
  children: ReactNode;
  camera: { position: [number, number, number]; fov: number };
  /** Shown when WebGL is missing, the context is lost or the scene throws. */
  fallback: ReactNode;
  onFail?: (reason: GlFailReason) => void;
  fps?: number;
  antialias?: boolean;
};

/**
 * Every 3D canvas goes through here so a GPU problem degrades the page instead of
 * taking it down: no WebGL, a lost context, a render error or a struggling GPU
 * all swap in the fallback. Rendering is capped, paused off screen, and the pixel
 * ratio drops one step before giving up.
 */
export function GlCanvas({
  children,
  camera,
  fallback,
  onFail,
  fps = 30,
  antialias = true,
}: Props) {
  const [failed, setFailed] = useState<GlFailReason | null>(() =>
    webglSupported() ? null : "unsupported",
  );
  const [dpr, setDpr] = useState<[number, number]>([1, 1.5]);
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;

  const fail = useCallback((reason: GlFailReason) => {
    setFailed((current) => current ?? reason);
    onFailRef.current?.(reason);
  }, []);

  useEffect(() => {
    if (failed === "unsupported") onFailRef.current?.("unsupported");
  }, [failed]);

  const slow = useCallback(() => {
    if (dpr[1] > 1) setDpr([1, 1]);
    else fail("slow");
  }, [dpr, fail]);

  if (failed) return <>{fallback}</>;

  return (
    <Boundary onError={() => fail("error")}>
      <Canvas
        frameloop="demand"
        dpr={dpr}
        camera={camera}
        gl={{
          antialias,
          alpha: true,
          powerPreference: "default",
          failIfMajorPerformanceCaveat: true,
        }}
        style={{ touchAction: "pan-y" }}
        aria-hidden
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", (event) => {
            event.preventDefault();
            fail("context-lost");
          });
        }}
      >
        <Pacer fps={fps} onSlow={slow} />
        {children}
      </Canvas>
    </Boundary>
  );
}
