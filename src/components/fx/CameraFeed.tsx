import { useRef, useState } from "react";

import { useCanvasLoop } from "@/components/fx/decor";
import type { RoadState } from "@/lib/traffic-types";

/*
 * Camera feed for a junction. A real clip at /cams/j<id>.mp4 plays if present. Otherwise a small
 * traffic simulation is rendered as if seen by that junction's camera: its own layout (arm count
 * from the real road list), camera angle, zoom, time of day, weather, neighbourhood and vehicle mix.
 * Queues start from the live counts and the signal lamps follow the real phase.
 */

type Kind = "car" | "bike" | "auto" | "bus" | "truck";
const KINDS: Kind[] = ["car", "bike", "auto", "bus", "truck"];
const KIND: Record<Kind, { l: number; w: number; fill: string; vmax: number }> = {
  car: { l: 15, w: 7, fill: "#8a9096", vmax: 36 },
  bike: { l: 8, w: 3.2, fill: "#c9cfd4", vmax: 42 },
  auto: { l: 11, w: 6, fill: "#4fae82", vmax: 30 },
  bus: { l: 30, w: 9, fill: "#a8325e", vmax: 28 },
  truck: { l: 24, w: 8.5, fill: "#68707a", vmax: 26 },
};
const CAMS = ["OVERHEAD", "POLE-MOUNT", "GANTRY", "TETHER-CAM"];
const TOD = ["DAY", "DUSK", "NIGHT"];
const UX = [1, 0, -1, 0];
const UY = [0, 1, 0, -1];
const R = 250;
const GAP = 3.5;

type Veh = {
  id: number;
  kind: Kind;
  arm: number;
  lane: number;
  d: number;
  v: number;
  phase: 0 | 1 | 2;
  s: number;
  exit: number;
  x: number;
  y: number;
  hd: number;
};
type Sim = {
  id: number;
  n: number;
  rot: number;
  zoom: number;
  ox: number;
  oy: number;
  rw: number;
  night: 0 | 1 | 2;
  rain: boolean;
  mix: number[];
  cam: string;
  vehs: Veh[];
  nextId: number;
  lastT: number;
  t0: number;
  passed: number[];
  total: number;
  timers: number[];
  peds: { arm: number; s: number }[];
  buildings: { x: number; y: number; w: number; h: number; tone: number }[];
  scene: { c: HTMLCanvasElement; w: number; h: number } | null;
  glow: HTMLCanvasElement | null;
  drops: { x: number; y: number }[];
};

const seed = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const ux = (a: number) => UX[a] ?? 0;
const uy = (a: number) => UY[a] ?? 0;
const laneOff = (rw: number, lane: number) => rw * (0.13 + 0.24 * lane);

function pickKind(sim: Sim): Kind {
  const total = sim.mix.reduce((s, m) => s + m, 0);
  let r = Math.random() * total;
  for (let i = 0; i < KINDS.length; i++) {
    r -= sim.mix[i] ?? 0;
    if (r <= 0) return KINDS[i] ?? "car";
  }
  return "car";
}
const laneFor = (k: Kind) => (k === "car" || k === "auto" ? (Math.random() < 0.5 ? 0 : 1) : 1);

function makeSim(id: number, roads: RoadState[]): Sim {
  const n = Math.max(2, Math.min(4, roads.length));
  const r = (k: number) => seed(id * 17 + k);
  const rw = 46 + r(5) * 14;
  const nightRoll = r(6);
  const sim: Sim = {
    id,
    n,
    rot: (r(1) - 0.5) * 0.9,
    zoom: 0.85 + r(2) * 0.4,
    ox: (r(3) - 0.5) * 24,
    oy: (r(4) - 0.5) * 16,
    rw,
    night: nightRoll < 0.4 ? 0 : nightRoll < 0.72 ? 1 : 2,
    rain: r(7) > 0.8,
    mix: [
      0.3 + r(8) * 0.4,
      0.1 + r(9) * 0.5,
      0.05 + r(10) * 0.3,
      0.02 + r(11) * 0.12,
      0.02 + r(12) * 0.1,
    ],
    cam: CAMS[Math.floor(r(13) * CAMS.length)] ?? "OVERHEAD",
    vehs: [],
    nextId: 100 + Math.floor(r(14) * 800),
    lastT: -1,
    t0: 0,
    passed: [],
    total: 0,
    timers: [0.4, 0.9, 1.4, 1.9],
    peds: [],
    buildings: [],
    scene: null,
    glow: null,
    drops: Array.from({ length: 60 }, (_, i) => ({ x: seed(i + id), y: seed(i * 3 + id) })),
  };
  // neighbourhood: blocks off the road corridors
  const band = rw / 2 + 28;
  const corridor = (x: number, y: number) => {
    for (let a = 0; a < n; a++) {
      const along = x * ux(a) + y * uy(a);
      const across = Math.abs(-x * uy(a) + y * ux(a));
      if (along > -band && across < band) return true;
    }
    return Math.abs(x) < band && Math.abs(y) < band;
  };
  for (let gx = -320; gx <= 320; gx += 34) {
    for (let gy = -260; gy <= 260; gy += 34) {
      const k = id * 1000 + gx * 7 + gy * 13;
      const x = gx + (seed(k) - 0.5) * 10;
      const y = gy + (seed(k + 1) - 0.5) * 10;
      if (corridor(x, y) || seed(k + 2) < 0.2) continue;
      sim.buildings.push({
        x,
        y,
        w: 16 + seed(k + 3) * 16,
        h: 16 + seed(k + 4) * 16,
        tone: seed(k + 5),
      });
    }
  }
  // queues start from the live counts
  roads.slice(0, n).forEach((road, a) => {
    const cursor = [rw / 2 + 12 + 2, rw / 2 + 12 + 2];
    const count = Math.min(Math.round(road.vehicle_count), 10);
    for (let i = 0; i < count; i++) {
      const kind = pickKind(sim);
      const lane = kind === "car" || kind === "auto" ? i % 2 : 1;
      const l = KIND[kind].l;
      const d = (cursor[lane] ?? 0) + l / 2;
      if (d > R - 30) break;
      cursor[lane] = (cursor[lane] ?? 0) + l + GAP;
      sim.vehs.push({
        id: sim.nextId++,
        kind,
        arm: a,
        lane,
        d,
        v: 0,
        phase: 0,
        s: 0,
        exit: a,
        x: 0,
        y: 0,
        hd: 0,
      });
    }
    for (let k = 0; k < 3; k++) sim.peds.push({ arm: a, s: (k * 0.37 + seed(id + a * 5 + k)) % 1 });
  });
  return sim;
}

function view(g: CanvasRenderingContext2D, sim: Sim, w: number, h: number) {
  const s = (h / 220) * sim.zoom;
  g.translate(w / 2, h / 2);
  g.scale(s, s);
  g.rotate(sim.rot);
  g.translate(sim.ox, sim.oy);
  return s;
}
function toScreen(sim: Sim, w: number, h: number, x: number, y: number): [number, number] {
  const s = (h / 220) * sim.zoom;
  const X = x + sim.ox;
  const Y = y + sim.oy;
  const c = Math.cos(sim.rot);
  const si = Math.sin(sim.rot);
  return [w / 2 + s * (X * c - Y * si), h / 2 + s * (X * si + Y * c)];
}

function renderScene(sim: Sim, w: number, h: number, dpr: number) {
  const c = document.createElement("canvas");
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const g = c.getContext("2d");
  if (!g) return c;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#0c0e10";
  g.fillRect(0, 0, w, h);
  g.save();
  view(g, sim, w, h);
  const rw = sim.rw;
  for (const b of sim.buildings) {
    const t = 18 + Math.floor(b.tone * 14);
    g.fillStyle = `rgb(${t},${t + 2},${t + 4})`;
    g.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
    g.strokeStyle = "rgba(255,45,120,0.10)";
    g.lineWidth = 0.6;
    g.strokeRect(b.x - b.w / 2 + 2, b.y - b.h / 2 + 2, b.w - 4, b.h - 4);
    if (b.tone > 0.55) {
      g.fillStyle = "rgba(230,233,236,0.07)";
      g.fillRect(b.x - 3, b.y - 3, 6, 6);
    }
  }
  g.fillStyle = "#1b1e22";
  g.fillRect(-rw / 2 - 6, -rw / 2 - 6, rw + 12, rw + 12);
  for (let a = 0; a < sim.n; a++) {
    g.save();
    g.rotate((a * Math.PI) / 2);
    g.fillStyle = "#2a2e33"; // sidewalks
    g.fillRect(rw / 2, -rw / 2 - 7, R, 7);
    g.fillRect(rw / 2, rw / 2, R, 7);
    g.fillStyle = "#15181b"; // asphalt
    g.fillRect(0, -rw / 2, R, rw);
    g.strokeStyle = "rgba(230,233,236,0.55)"; // centre line
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(rw / 2 + 14, 0);
    g.lineTo(R, 0);
    g.stroke();
    g.strokeStyle = "rgba(230,233,236,0.22)"; // lane dividers
    g.setLineDash([7, 9]);
    g.lineWidth = 0.9;
    for (const y of [-rw * 0.25, rw * 0.25]) {
      g.beginPath();
      g.moveTo(rw / 2 + 14, y);
      g.lineTo(R, y);
      g.stroke();
    }
    g.setLineDash([]);
    g.fillStyle = "rgba(230,233,236,0.5)"; // zebra
    for (let y = -rw / 2 + 2; y < rw / 2 - 2; y += 6) g.fillRect(rw / 2 + 3, y, 7, 3);
    g.fillRect(rw / 2 + 12, 0, 2, rw / 2); // stop line, incoming side
    g.restore();
  }
  g.fillStyle = "#15181b";
  g.fillRect(-rw / 2, -rw / 2, rw, rw);
  g.restore();
  return c;
}

function glowSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 48;
  const g = c.getContext("2d");
  if (!g) return c;
  const gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
  gr.addColorStop(0, "rgba(255,255,255,0.9)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 48, 48);
  return c;
}

function bez(a: number, b: number, c: number, s: number) {
  return (1 - s) * (1 - s) * a + 2 * (1 - s) * s * b + s * s * c;
}
function place(sim: Sim, v: Veh) {
  const rw = sim.rw;
  const lo = laneOff(rw, v.lane);
  const inP = (a: number, d: number): [number, number] => [
    ux(a) * d - uy(a) * lo,
    uy(a) * d + ux(a) * lo,
  ];
  const outP = (a: number, d: number): [number, number] => [
    ux(a) * d + uy(a) * lo,
    uy(a) * d - ux(a) * lo,
  ];
  if (v.phase === 0) {
    [v.x, v.y] = inP(v.arm, v.d);
    v.hd = Math.atan2(-uy(v.arm), -ux(v.arm));
  } else if (v.phase === 2) {
    [v.x, v.y] = outP(v.arm, v.d);
    v.hd = Math.atan2(uy(v.arm), ux(v.arm));
  } else {
    const p0 = inP(v.arm, rw / 2);
    const p2 = outP(v.exit, rw / 2);
    const straight = v.exit === (v.arm + 2) % 4;
    const p1: [number, number] = straight ? [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2] : [0, 0];
    v.x = bez(p0[0], p1[0], p2[0], v.s);
    v.y = bez(p0[1], p1[1], p2[1], v.s);
    const dx = 2 * (1 - v.s) * (p1[0] - p0[0]) + 2 * v.s * (p2[0] - p1[0]);
    const dy = 2 * (1 - v.s) * (p1[1] - p0[1]) + 2 * v.s * (p2[1] - p1[1]);
    if (Math.abs(dx) + Math.abs(dy) > 1e-6) v.hd = Math.atan2(dy, dx);
  }
}

function step(sim: Sim, roads: RoadState[], dt: number, t: number) {
  const rw = sim.rw;
  const STOP = rw / 2 + 12;
  const green = (a: number) => roads[a]?.is_currently_green ?? true;
  for (let a = 0; a < sim.n; a++) {
    sim.timers[a] = (sim.timers[a] ?? 0) - dt;
    if ((sim.timers[a] ?? 0) > 0) continue;
    const count = Math.min(Math.round(roads[a]?.vehicle_count ?? 0), 12);
    const here = sim.vehs.filter((v) => v.arm === a && v.phase === 0).length;
    sim.timers[a] = here < count ? 0.3 : (1.3 + Math.random() * 1.8) / (0.5 + count / 12);
    const kind = pickKind(sim);
    const lane = laneFor(kind);
    if (sim.vehs.some((v) => v.arm === a && v.lane === lane && v.phase === 0 && v.d > R - 40))
      continue;
    sim.vehs.push({
      id: sim.nextId++,
      kind,
      arm: a,
      lane,
      d: R,
      v: KIND[kind].vmax * 0.8,
      phase: 0,
      s: 0,
      exit: a,
      x: 0,
      y: 0,
      hd: 0,
    });
  }
  const groups = new Map<string, Veh[]>();
  for (const v of sim.vehs) {
    if (v.phase !== 0) continue;
    const k = `${v.arm}-${v.lane}`;
    const g = groups.get(k);
    if (g) g.push(v);
    else groups.set(k, [v]);
  }
  for (const g of groups.values()) {
    g.sort((a, b) => a.d - b.d);
    let prev: Veh | null = null;
    for (const v of g) {
      const K = KIND[v.kind];
      let lim = -Infinity;
      if (!green(v.arm) && v.d - K.l / 2 >= STOP - 0.6) lim = STOP + K.l / 2;
      if (prev) lim = Math.max(lim, prev.d + KIND[prev.kind].l / 2 + K.l / 2 + GAP);
      const want = Math.min(K.vmax, Math.max(0, (v.d - lim) * 3));
      v.v += (want - v.v) * Math.min(1, dt * (want > v.v ? 1.6 : 6));
      let nd = v.d - v.v * dt;
      if (nd < lim) {
        v.v = dt > 0 ? Math.max(0, (v.d - lim) / dt) : 0;
        nd = lim;
      }
      v.d = nd;
      prev = v;
    }
  }
  for (const v of sim.vehs) {
    const K = KIND[v.kind];
    if (v.phase === 0 && v.d <= rw / 2) {
      const opp = (v.arm + 2) % 4;
      const others = Array.from({ length: sim.n }, (_, i) => i).filter((i) => i !== v.arm);
      v.exit =
        opp < sim.n && (Math.random() < 0.7 || others.length === 1)
          ? opp
          : (others[Math.floor(Math.random() * others.length)] ?? opp);
      v.phase = 1;
      v.s = 0;
    } else if (v.phase === 1) {
      v.v += (K.vmax * 0.55 - v.v) * Math.min(1, dt * 2);
      v.s += (v.v * dt) / (rw * 1.25);
      if (v.s >= 1) {
        v.phase = 2;
        v.arm = v.exit;
        v.d = rw / 2;
        sim.passed.push(t);
        sim.total++;
      }
    } else if (v.phase === 2) {
      v.v += (K.vmax - v.v) * Math.min(1, dt * 1.5);
      v.d += v.v * dt;
    }
    place(sim, v);
  }
  sim.vehs = sim.vehs.filter((v) => !(v.phase === 2 && v.d > R));
  sim.passed = sim.passed.filter((p) => t - p < 60);
  for (const p of sim.peds) if (!green(p.arm)) p.s = p.s + dt * 0.1 > 1 ? 0 : p.s + dt * 0.1;
}

function drawFeed(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  sim: Sim,
  roads: RoadState[],
) {
  const dpr = ctx.canvas.width / w;
  const s = (h / 220) * sim.zoom;
  const rw = sim.rw;
  const dt = sim.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, t - sim.lastT));
  if (sim.lastT < 0) sim.t0 = t;
  sim.lastT = t;
  step(sim, roads, dt, t);

  if (!sim.scene || sim.scene.w !== w || sim.scene.h !== h)
    sim.scene = { c: renderScene(sim, w, h, dpr), w, h };
  ctx.drawImage(sim.scene.c, 0, 0, w, h);

  ctx.save();
  view(ctx, sim, w, h);
  for (const p of sim.peds) {
    const y = -rw / 2 + p.s * rw;
    ctx.save();
    ctx.rotate((p.arm * Math.PI) / 2);
    ctx.fillStyle = "rgba(240,242,244,0.9)";
    ctx.beginPath();
    ctx.arc(rw / 2 + 6.5, y, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  for (const v of sim.vehs) {
    const K = KIND[v.kind];
    const brake = v.v < 3 || (v.phase === 0 && !(roads[v.arm]?.is_currently_green ?? true));
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.hd);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(-K.l / 2 + 1, -K.w / 2 + 1.5, K.l, K.w);
    ctx.fillStyle = K.fill;
    ctx.fillRect(-K.l / 2, -K.w / 2, K.l, K.w);
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    if (v.kind === "bike") {
      ctx.fillStyle = "#ff2d78";
      ctx.beginPath();
      ctx.arc(-0.5, 0, 1.9, 0, Math.PI * 2);
      ctx.fill();
    } else if (v.kind === "bus") {
      ctx.fillRect(-K.l / 2 + 2, -K.w / 2 + 1.5, K.l - 4, K.w - 3);
    } else {
      ctx.fillRect(-K.l * 0.12, -K.w / 2 + 1, K.l * 0.34, K.w - 2);
    }
    ctx.fillStyle = brake ? "#ff4d3d" : "#7a2a26";
    ctx.fillRect(-K.l / 2, -K.w / 2, 1.4, 1.6);
    ctx.fillRect(-K.l / 2, K.w / 2 - 1.6, 1.4, 1.6);
    ctx.restore();
  }
  ctx.restore();

  if (sim.night > 0) {
    ctx.fillStyle = sim.night === 1 ? "rgba(6,8,12,0.34)" : "rgba(4,6,10,0.6)";
    ctx.fillRect(0, 0, w, h);
  }
  if (!sim.glow) sim.glow = glowSprite();
  ctx.save();
  view(ctx, sim, w, h);
  ctx.globalCompositeOperation = "lighter";
  if (sim.night > 0) {
    for (const v of sim.vehs) {
      if (v.v < 2) continue;
      const K = KIND[v.kind];
      const fx = v.x + Math.cos(v.hd) * (K.l * 0.5 + 6);
      const fy = v.y + Math.sin(v.hd) * (K.l * 0.5 + 6);
      ctx.globalAlpha = sim.night === 2 ? 0.55 : 0.3;
      ctx.drawImage(sim.glow, fx - 13, fy - 13, 26, 26);
    }
  }
  for (let a = 0; a < sim.n; a++) {
    const g = roads[a]?.is_currently_green ?? true;
    const lx = ux(a) * (rw / 2 + 12) - uy(a) * (rw / 2 + 6);
    const ly = uy(a) * (rw / 2 + 12) + ux(a) * (rw / 2 + 6);
    ctx.globalAlpha = 0.95;
    ctx.drawImage(sim.glow, lx - 9, ly - 9, 18, 18);
    ctx.globalAlpha = 1;
    ctx.fillStyle = g ? "#3ddc84" : "#ff4d3d";
    ctx.beginPath();
    ctx.arc(lx, ly, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  if (sim.rain) {
    ctx.strokeStyle = "rgba(200,210,220,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of sim.drops) {
      const x = ((d.x * w + t * 40) % w) | 0;
      const y = ((d.y * h + t * 260) % h) | 0;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + 9);
    }
    ctx.stroke();
  }

  const wide = w > 420;
  const fs = Math.max(8, Math.min(11, w / 46));
  ctx.font = `600 ${fs}px "JetBrains Mono", monospace`;
  ctx.textBaseline = "alphabetic";

  for (const v of sim.vehs) {
    const K = KIND[v.kind];
    const [sx, sy] = toScreen(sim, w, h, v.x, v.y);
    if (sx < 0 || sy < 0 || sx > w || sy > h) continue;
    const ang = v.hd + sim.rot;
    const hx = (Math.abs(Math.cos(ang)) * K.l * 0.5 + Math.abs(Math.sin(ang)) * K.w * 0.5) * s + 2;
    const hy = (Math.abs(Math.sin(ang)) * K.l * 0.5 + Math.abs(Math.cos(ang)) * K.w * 0.5) * s + 2;
    const kmh = Math.round(v.v * 1.1);
    const stopped = kmh < 2;
    ctx.strokeStyle = stopped ? "rgba(255,77,61,0.9)" : "rgba(255,45,120,0.9)";
    ctx.lineWidth = 1;
    ctx.strokeRect(sx - hx, sy - hy, hx * 2, hy * 2);
    if (v.kind === "bus" || v.kind === "truck" || (wide && v.id % 3 === 0)) {
      ctx.fillStyle = stopped ? "#ff4d3d" : "#ff2d78";
      ctx.fillText(`${v.kind} ${stopped ? "stop" : kmh}`, sx - hx, sy - hy - 2);
    }
  }

  for (let a = 0; a < sim.n; a++) {
    const r = roads[a];
    if (!r) continue;
    const g = r.is_currently_green;
    let [cx, cy] = toScreen(sim, w, h, ux(a) * 125, uy(a) * 125);
    let left = "";
    if (g && r.phase_started_at) {
      const rem = r.green_duration_sec - (Date.now() - Date.parse(r.phase_started_at)) / 1000;
      if (Number.isFinite(rem)) left = ` ${Math.max(0, Math.round(rem))}s`;
    }
    const label = `${r.direction.slice(0, 5)} ${Math.round(r.vehicle_count)}v ${g ? "GO" : "STOP"}${left}`;
    const cw = ctx.measureText(label).width + 12;
    cx = Math.max(cw / 2 + 4, Math.min(w - cw / 2 - 4, cx));
    cy = Math.max(30, Math.min(h - 34, cy));
    ctx.fillStyle = "rgba(6,8,10,0.72)";
    ctx.fillRect(cx - cw / 2, cy - fs, cw, fs * 1.7);
    ctx.strokeStyle = g ? "#3ddc84" : "#ff4d3d";
    ctx.strokeRect(cx - cw / 2, cy - fs, cw, fs * 1.7);
    ctx.fillStyle = g ? "#3ddc84" : "#ff4d3d";
    ctx.fillText(label, cx - cw / 2 + 6, cy + fs * 0.32);
  }

  // sensor grain, vignette, rolling scan band
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  for (let i = 0; i < 90; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,45,120,0.05)";
  ctx.fillRect(0, ((t * 55) % (h + 30)) - 30, w, 30);
  ctx.fillStyle = "rgba(0,0,0,0.58)";
  ctx.fillRect(0, h - fs * 2.1, w, fs * 2.1);
  ctx.fillStyle = "#e6e9ec";
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  ctx.fillText(
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}:${pad(Math.floor(now.getMilliseconds() * 0.03))}`,
    8,
    h - fs * 0.7,
  );
  const tally = KINDS.map(
    (k) => `${k.slice(0, 3).toUpperCase()} ${sim.vehs.filter((v) => v.kind === k).length}`,
  ).join("  ");
  const moving = sim.vehs.filter((v) => v.v > 2);
  const avg = moving.length
    ? Math.round((moving.reduce((q, v) => q + v.v, 0) / moving.length) * 1.1)
    : 0;
  const elapsed = Math.max(8, Math.min(60, t - sim.t0));
  const thru = `THRU ${Math.round((sim.passed.length * 60) / elapsed)}/MIN  AVG ${avg}KMH`;
  ctx.fillText(thru, w - ctx.measureText(thru).width - 8, h - fs * 0.7);
  if (wide) ctx.fillText(tally, w / 2 - ctx.measureText(tally).width / 2, h - fs * 0.7);
  ctx.fillStyle = Math.floor(t * 1.6) % 2 === 0 ? "#ff2d78" : "rgba(255,45,120,0.2)";
  ctx.beginPath();
  ctx.arc(14, 15, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e6e9ec";
  ctx.fillText(
    `REC  CAM-${String(sim.id).padStart(3, "0")}  ${sim.cam}  ${sim.zoom.toFixed(1)}x`,
    24,
    19,
  );
  const env = `${TOD[sim.night]}${sim.rain ? " · RAIN" : ""}`;
  ctx.fillText(env, w - ctx.measureText(env).width - 8, 19);
  ctx.strokeStyle = "rgba(255,45,120,0.8)";
  ctx.lineWidth = 1.5;
  const b = 12;
  for (const [x, y, dx, dy] of [
    [3, 3, 1, 1],
    [w - 3, 3, -1, 1],
    [3, h - 3, 1, -1],
    [w - 3, h - 3, -1, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(x + dx * b, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * b);
    ctx.stroke();
  }
}

export function CameraFeed({ junctionId, roads }: { junctionId: number; roads: RoadState[] }) {
  const [real, setReal] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const roadsRef = useRef(roads);
  roadsRef.current = roads;
  const simRef = useRef<Sim | null>(null);

  useCanvasLoop(
    canvas,
    (ctx, w, h, t) => {
      const list = roadsRef.current;
      if (list.length === 0) {
        ctx.fillStyle = "#0c0e10";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#8f979e";
        ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillText("ACQUIRING SIGNAL…", 12, h / 2);
        return;
      }
      const n = Math.max(2, Math.min(4, list.length));
      let sim = simRef.current;
      if (!sim || sim.id !== junctionId || sim.n !== n) {
        sim = makeSim(junctionId, list);
        simRef.current = sim;
      }
      drawFeed(ctx, w, h, t, sim, list);
    },
    30,
  );

  return (
    <div className="cam">
      <div className="cam-view">
        <canvas
          ref={canvas}
          className="cam-media"
          role="img"
          aria-label={`Camera view of junction ${junctionId}`}
        />
        <video
          className="cam-media"
          style={{ opacity: real ? 1 : 0, pointerEvents: "none" }}
          src={`/cams/j${junctionId}.mp4`}
          muted
          loop
          playsInline
          autoPlay
          preload="metadata"
          onLoadedData={() => setReal(true)}
          onError={() => setReal(false)}
        />
      </div>
    </div>
  );
}
