import { describe, expect, it } from "vitest";
import { neighbourInDirection } from "@/lib/map-nav";

const grid = [
  { junction_id: 1, latitude: 13.0, longitude: 80.2 },
  { junction_id: 2, latitude: 13.02, longitude: 80.2 }, // north of 1
  { junction_id: 3, latitude: 12.98, longitude: 80.2 }, // south of 1
  { junction_id: 4, latitude: 13.0, longitude: 80.22 }, // east of 1
  { junction_id: 5, latitude: 13.0, longitude: 80.17 }, // west of 1
  { junction_id: 6, latitude: 13.1, longitude: 80.3 }, // far north-east
];
const at = (id: number) => grid.find((g) => g.junction_id === id)!;

describe("neighbourInDirection", () => {
  it("moves to the nearest junction in each direction", () => {
    expect(neighbourInDirection(grid, at(1), "up")?.junction_id).toBe(2);
    expect(neighbourInDirection(grid, at(1), "down")?.junction_id).toBe(3);
    expect(neighbourInDirection(grid, at(1), "right")?.junction_id).toBe(4);
    expect(neighbourInDirection(grid, at(1), "left")?.junction_id).toBe(5);
  });

  it("never returns the junction it starts from", () => {
    for (const dir of ["up", "down", "left", "right"] as const) {
      expect(neighbourInDirection(grid, at(1), dir)?.junction_id).not.toBe(1);
    }
  });

  it("prefers a junction straight ahead over a nearer one off to the side", () => {
    const items = [
      { junction_id: 1, latitude: 13.0, longitude: 80.2 },
      { junction_id: 2, latitude: 13.03, longitude: 80.2 }, // 3.3 km straight north
      { junction_id: 3, latitude: 13.012, longitude: 80.222 }, // closer but well off to the east
    ];
    expect(neighbourInDirection(items, items[0]!, "up")?.junction_id).toBe(2);
  });

  it("falls back to the half-plane when nothing is in the cone, and to null at the edge", () => {
    const items = [
      { junction_id: 1, latitude: 13.0, longitude: 80.2 },
      { junction_id: 2, latitude: 13.01, longitude: 80.25 }, // mostly east, a little north
    ];
    expect(neighbourInDirection(items, items[0]!, "up")?.junction_id).toBe(2);
    expect(neighbourInDirection(items, items[0]!, "down")).toBeNull();
  });

  it("works from a bare map position with no junction selected", () => {
    const centre = { latitude: 13.0, longitude: 80.2 };
    expect(neighbourInDirection(grid.slice(1), centre, "up")?.junction_id).toBe(2);
  });
});
