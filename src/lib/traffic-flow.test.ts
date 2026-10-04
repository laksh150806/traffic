import { describe, expect, it } from "vitest";
import { PbfWriter } from "pbf";
import { decodeFlowTile, fetchTrafficSnapshot } from "@/lib/flow-tiles.server";
import {
  FAR_M,
  FLOW_ZOOM,
  distanceToLineM,
  junctionFlow,
  parseTile,
  tileOf,
  tilesFor,
  volumeToCapacity,
  type FlowSegment,
} from "@/lib/traffic-flow";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";

describe("tiles", () => {
  it("finds the tile central Chennai is in", () => {
    expect(tileOf(13.05, 80.22, FLOW_ZOOM)).toEqual({ x: 2960, y: 1898 });
  });

  it("adds the neighbour only when a point is near a tile edge", () => {
    const middle = tilesFor([{ lat: 13.05, lng: 80.22 }]);
    expect(middle).toHaveLength(1);
    // The east edge of tile 2960 is at longitude 80.2441; 100 m short of it, the next tile is wanted too.
    const edge = tilesFor([{ lat: 13.05, lng: 80.2432 }]);
    expect(edge.map((t) => t.x).sort()).toEqual([2960, 2961]);
  });

  it("covers every junction with a modest number of tiles", () => {
    const tiles = tilesFor(SEED_JUNCTIONS);
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles.length).toBeLessThan(30);
  });
});

describe("tile addresses from a URL", () => {
  it("accepts a real tile", () => {
    expect(parseTile("12", "2960", "1898")).toEqual({ z: 12, x: 2960, y: 1898 });
  });
  it("refuses anything else, so the proxy cannot be pointed elsewhere", () => {
    expect(parseTile("12", "2960", "1898.png")).toBeNull();
    expect(parseTile("12", "../x", "1")).toBeNull();
    expect(parseTile("3", "1", "1")).toBeNull(); // zoomed out too far
    expect(parseTile("19", "1", "1")).toBeNull(); // zoomed in too far
    expect(parseTile("12", "4096", "1")).toBeNull(); // off the map
    expect(parseTile("12", "-1", "1")).toBeNull();
  });
});

describe("distance to a road", () => {
  const line: Array<[number, number]> = [
    [80.2, 13.0],
    [80.21, 13.0],
  ];
  it("is about 111 m for a point 0.001 degrees of latitude off the road", () => {
    expect(distanceToLineM(13.001, 80.205, line)).toBeGreaterThan(105);
    expect(distanceToLineM(13.001, 80.205, line)).toBeLessThan(118);
  });
  it("measures to the end of the road, not the line beyond it", () => {
    const beyond = distanceToLineM(13.0, 80.22, line);
    expect(beyond).toBeGreaterThan(1000);
  });
});

describe("speed around a junction", () => {
  const road = (ratio: number, lat: number): FlowSegment => ({
    ratio,
    roadType: "Major road",
    line: [
      [80.2, lat],
      [80.21, lat],
    ],
  });

  it("averages the roads close by, nearer ones counting for more", () => {
    const flow = junctionFlow(7, 13.0, 80.205, [road(0.4, 13.0), road(1, 13.0009)]);
    expect(flow.samples).toBe(2);
    expect(flow.ratio).toBeGreaterThan(0.4);
    expect(flow.ratio).toBeLessThan(0.7); // pulled towards the nearer, slower road
    expect(flow.nearestM).toBeLessThan(5);
  });

  it("ignores segments with no reading", () => {
    expect(junctionFlow(7, 13.0, 80.205, [road(0, 13.0)]).ratio).toBeNull();
    expect(junctionFlow(7, 13.0, 80.205, [road(0, 13.0), road(0.8, 13.0005)]).ratio).toBe(0.8);
  });

  it("falls back to a wider search, and reports nothing when there is no road at all", () => {
    const farther = junctionFlow(7, 13.0, 80.205, [road(0.6, 13.0 + 180 / 111_320)]);
    expect(farther.ratio).toBe(0.6);
    expect(farther.nearestM).toBeGreaterThan(150);
    const none = junctionFlow(7, 13.0, 80.205, [road(0.6, 13.0 + (FAR_M + 100) / 111_320)]);
    expect(none).toEqual({ id: 7, ratio: null, samples: 0, nearestM: null });
  });
});

describe("speed to volume over capacity", () => {
  it("is low on an empty road and rises as speed falls", () => {
    expect(volumeToCapacity(1)).toBeLessThan(0.3);
    const points = [1, 0.95, 0.9, 0.8, 0.65, 0.5, 0.35].map(volumeToCapacity);
    for (let i = 1; i < points.length; i += 1)
      expect(points[i]!).toBeGreaterThanOrEqual(points[i - 1]!);
  });
  it("matches the Bureau of Public Roads curve at the usual points", () => {
    expect(volumeToCapacity(0.8)).toBeCloseTo(1.14, 1);
    expect(volumeToCapacity(0.5)).toBeCloseTo(1.6, 1);
  });
  it("stays inside sensible bounds for any input", () => {
    expect(volumeToCapacity(0)).toBeLessThanOrEqual(1.6);
    expect(volumeToCapacity(5)).toBeGreaterThanOrEqual(0.25);
    expect(Number.isFinite(volumeToCapacity(0.2))).toBe(true);
  });
});

/** Builds a vector tile holding the given lines, laid out the way TomTom's flow layer is. */
function buildTile(
  features: Array<{ level: number; road: string; points: Array<[number, number]> }>,
) {
  const zigzag = (n: number) => (n << 1) ^ (n >> 31);
  const layer = new PbfWriter();
  layer.writeVarintField(15, 2);
  layer.writeStringField(1, "Traffic flow");
  features.forEach((f, i) => {
    const geometry: number[] = [];
    let x = 0;
    let y = 0;
    f.points.forEach(([px, py], k) => {
      if (k === 0) geometry.push((1 << 3) | 1);
      else if (k === 1) geometry.push(((f.points.length - 1) << 3) | 2);
      geometry.push(zigzag(px - x), zigzag(py - y));
      x = px;
      y = py;
    });
    layer.writeMessage(
      2,
      (_: null, w) => {
        w.writePackedVarint(2, [0, 2 * i, 1, 2 * i + 1]);
        w.writeVarintField(3, 2);
        w.writePackedVarint(4, geometry);
      },
      null,
    );
  });
  layer.writeStringField(3, "traffic_level");
  layer.writeStringField(3, "road_type");
  for (const f of features) {
    layer.writeMessage(4, (_: null, w) => w.writeDoubleField(3, f.level), null);
    layer.writeMessage(4, (_: null, w) => w.writeStringField(1, f.road), null);
  }
  layer.writeVarintField(5, 4096);
  const tile = new PbfWriter();
  tile.writeBytesField(3, layer.finish());
  return tile.finish();
}

describe("decoding a flow tile", () => {
  it("reads each road's level and where it runs", () => {
    const tile = buildTile([
      {
        level: 0.62,
        road: "Major road",
        points: [
          [1000, 1000],
          [3000, 1000],
        ],
      },
      {
        level: 0,
        road: "Secondary road",
        points: [
          [500, 500],
          [900, 900],
        ],
      },
    ]);
    const segments = decodeFlowTile(tile, { x: 2960, y: 1898 });
    expect(segments).toHaveLength(2);
    expect(segments[0]?.ratio).toBeCloseTo(0.62, 5);
    expect(segments[0]?.roadType).toBe("Major road");
    const [a, b] = segments[0]!.line;
    expect(a![0]).toBeLessThan(b![0]); // runs east
    expect(a![1]).toBeCloseTo(b![1], 6);
    // Inside the tile: between 80.1 and 80.3 east, 12.9 and 13.2 north
    expect(a![0]).toBeGreaterThan(80.1);
    expect(a![0]).toBeLessThan(80.3);
    expect(segments[1]?.ratio).toBe(0);
  });

  it("returns nothing for a tile without the flow layer", () => {
    const empty = new PbfWriter();
    expect(decodeFlowTile(empty.finish(), { x: 1, y: 1 })).toEqual([]);
  });
});

describe("fetching a snapshot", () => {
  it("builds one reading per junction and counts the tiles that answered", async () => {
    let calls = 0;
    const fetcher = (async (url: string | URL | Request) => {
      calls += 1;
      expect(String(url)).toContain("api.tomtom.com/traffic/map/4/tile/flow/relative/12/");
      expect(String(url)).toContain("key=test-key");
      // Every second tile fails, as a flaky network might.
      if (calls % 2 === 0) return new Response("no", { status: 500 });
      const tile = buildTile([
        {
          level: 0.5,
          road: "Major road",
          points: [
            [0, 0],
            [4000, 4000],
          ],
        },
      ]);
      return new Response(tile.slice().buffer as ArrayBuffer);
    }) as typeof fetch;
    const snapshot = await fetchTrafficSnapshot("test-key", fetcher, 12345);
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.fetchedAtMs).toBe(12345);
    expect(snapshot.junctions).toHaveLength(69);
    expect(snapshot.tilesTotal).toBe(calls);
    expect(snapshot.tilesOk).toBeGreaterThan(0);
    expect(snapshot.tilesOk).toBeLessThan(snapshot.tilesTotal);
  });
});
