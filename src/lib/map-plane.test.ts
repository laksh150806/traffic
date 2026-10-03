import { describe, expect, it } from "vitest";
import { nearestLinks, planeFrameFor, toPlane } from "@/lib/map-plane";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";

const points = SEED_JUNCTIONS.map((j) => ({ lat: j.lat, lng: j.lng }));

describe("map-plane", () => {
  it("falls back to a neutral frame when there are no points", () => {
    expect(planeFrameFor([])).toEqual({ midLat: 0, midLng: 0, scale: 1 });
  });

  it("centres the network on the origin and fits inside the square", () => {
    const frame = planeFrameFor(points, 7);
    const spots = points.map((p) => toPlane(p, frame));
    const xs = spots.map(([x]) => x);
    const zs = spots.map(([, z]) => z);
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(0);
    expect((Math.max(...zs) + Math.min(...zs)) / 2).toBeCloseTo(0);
    expect(
      Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)),
    ).toBeCloseTo(7);
  });

  it("puts north at -Z and east at +X", () => {
    const frame = planeFrameFor(points);
    const north = toPlane({ lat: frame.midLat + 0.1, lng: frame.midLng }, frame);
    const east = toPlane({ lat: frame.midLat, lng: frame.midLng + 0.1 }, frame);
    expect(north[1]).toBeLessThan(0);
    expect(east[0]).toBeGreaterThan(0);
  });

  it("links neighbours without duplicates or self links", () => {
    const frame = planeFrameFor(points);
    const links = nearestLinks(
      points.map((p) => toPlane(p, frame)),
      2,
    );
    const keys = links.map(([a, b]) => `${a}-${b}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(links.every(([a, b]) => a < b)).toBe(true);
    expect(links.length).toBeGreaterThan(points.length / 2);
  });

  it("drops links longer than the cut-off", () => {
    expect(
      nearestLinks(
        [
          [0, 0],
          [1, 0],
          [50, 0],
        ],
        2,
        2,
      ),
    ).toEqual([[0, 1]]);
  });
});
