import * as THREE from "three";

export type LabelLine = {
  text: string;
  /** Font size in CSS pixels at 1x. */
  size: number;
  color?: string;
  weight?: number;
};

const FONT = '"Manrope", "Segoe UI", sans-serif';

/** Soft round falloff used for floor glow, signal halos and dust. */
export function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Draws a small frosted-glass label to a canvas texture. Used instead of
 * drei's <Html>, which mounts a separate React root per label and throws
 * removeChild errors when labels come and go during a render.
 */
export function makeLabelTexture(lines: LabelLine[], scale = 2) {
  const padX = 14;
  const padY = 10;
  const gap = 4;
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) throw new Error("2D canvas unavailable");

  let width = 0;
  for (const line of lines) {
    measure.font = `${line.weight ?? 500} ${line.size}px ${FONT}`;
    width = Math.max(width, measure.measureText(line.text).width);
  }
  const cssWidth = Math.ceil(width + padX * 2);
  const cssHeight = Math.ceil(
    lines.reduce((sum, line) => sum + line.size * 1.2, 0) + gap * (lines.length - 1) + padY * 2,
  );

  const canvas = document.createElement("canvas");
  canvas.width = cssWidth * scale;
  canvas.height = cssHeight * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.scale(scale, scale);

  // Glass body, rim and sheen.
  const radius = 12;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(1, 1, cssWidth - 2, cssHeight - 2, radius);
  else ctx.rect(1, 1, cssWidth - 2, cssHeight - 2);
  ctx.fillStyle = "rgba(24, 22, 64, 0.72)";
  ctx.fill();
  const sheen = ctx.createLinearGradient(0, 0, 0, cssHeight);
  sheen.addColorStop(0, "rgba(255,255,255,0.22)");
  sheen.addColorStop(0.45, "rgba(255,255,255,0.03)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.stroke();

  ctx.textBaseline = "top";
  let y = padY;
  for (const line of lines) {
    ctx.font = `${line.weight ?? 500} ${line.size}px ${FONT}`;
    ctx.fillStyle = line.color ?? "#f1f4ff";
    ctx.fillText(line.text, padX, y);
    y += line.size * 1.2 + gap;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return { texture, cssWidth, cssHeight };
}
