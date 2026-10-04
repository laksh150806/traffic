import { describe, expect, it } from "vitest";
import { forecastNetwork, istDate } from "@/lib/forecast";
import {
  armForBearing,
  assessRoute,
  bearingDeg,
  distanceToSegment,
  fetchOsrmRoutes,
  formatKm,
  formatMinutes,
  haversineM,
  junctionsAlongRoute,
  rankRoutes,
  straightLineRoute,
  type LngLat,
  type OsrmRoute,
} from "@/lib/routing";

const line: LngLat[] = [
  [80.0, 13.0],
  [80.05, 13.0],
  [80.1, 13.0],
];
const stops = [
  { id: 1, name: "On the line", lat: 13.0004, lng: 80.05 },
  { id: 2, name: "Far away", lat: 13.05, lng: 80.05 },
  { id: 3, name: "Near the end", lat: 13.0, lng: 80.099 },
];

describe("geometry", () => {
  it("measures distance between points", () => {
    expect(haversineM([80, 13], [80, 13])).toBe(0);
    expect(haversineM([80, 13], [80, 14])).toBeGreaterThan(110_000);
    expect(haversineM([80, 13], [80, 14])).toBeLessThan(112_000);
  });

  it("finds the closest approach to a segment, clamped at the ends", () => {
    const mid = distanceToSegment([80.05, 13.001], [80.0, 13.0], [80.1, 13.0]);
    expect(mid.distance).toBeGreaterThan(100);
    expect(mid.distance).toBeLessThan(120);
    expect(mid.t).toBeCloseTo(0.5, 1);
    const past = distanceToSegment([80.2, 13.0], [80.0, 13.0], [80.1, 13.0]);
    expect(past.t).toBe(1);
  });
});

describe("junctionsAlongRoute", () => {
  it("keeps junctions near the line, in driving order, and drops far ones", () => {
    const found = junctionsAlongRoute(line, stops);
    expect(found.map((j) => j.junctionId)).toEqual([1, 3]);
    expect(found[0]!.alongM).toBeLessThan(found[1]!.alongM);
  });

  it("handles an empty or one-point route", () => {
    expect(junctionsAlongRoute([], stops)).toEqual([]);
    expect(junctionsAlongRoute([[80, 13]], stops)).toEqual([]);
  });
});

describe("assessRoute", () => {
  const route: OsrmRoute = { coordinates: line, distanceM: 10_000, durationSec: 900 };
  const peak = new Map(forecastNetwork(istDate(18, 30)).map((f) => [f.junctionId, f]));

  it("adds each junction's modelled delay to the drive time", () => {
    const here = [{ junctionId: 1, name: "A", arm: null, alongM: 100, offM: 10 }];
    const a = assessRoute(route, here, peak);
    expect(a.driveSec).toBe(900);
    expect(a.signalAdaptiveSec).toBe(Math.round(peak.get(1)!.delayAdaptive));
    expect(a.etaAdaptiveSec).toBe(900 + a.signalAdaptiveSec);
    expect(a.worst?.junctionId).toBe(1);
  });

  it("prices each junction at the time the vehicle reaches it", () => {
    const here = [
      { junctionId: 1, name: "A", arm: null, alongM: 0, offM: 5 },
      { junctionId: 2, name: "B", arm: null, alongM: 9_000, offM: 5 },
    ];
    const seen: Array<[number, number]> = [];
    const priced = assessRoute(route, here, (id, secondsIn) => {
      seen.push([id, Math.round(secondsIn)]);
      return peak.get(id);
    });
    expect(seen).toEqual([
      [1, 0],
      [2, 810],
    ]);
    expect(priced.junctions).toHaveLength(2);
  });

  it("gives a route the same id wherever it ranks", () => {
    const a = assessRoute(route, [], peak);
    const b = assessRoute({ ...route, durationSec: 5000 }, [], peak);
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(assessRoute({ ...route, distanceM: 12_000 }, [], peak).id);
  });

  it("reports no worst junction when the route crosses none", () => {
    const a = assessRoute(route, [], peak);
    expect(a.etaAdaptiveSec).toBe(900);
    expect(a.worst).toBeNull();
  });

  it("ranks the faster route first", () => {
    const slow = assessRoute({ ...route, durationSec: 2000 }, [], peak);
    const fast = assessRoute(route, [], peak);
    expect(rankRoutes([slow, fast])[0]).toBe(fast);
  });
});

describe("which arm a route waits on", () => {
  it("reads compass bearings", () => {
    expect(bearingDeg([80, 13], [80, 13.01])).toBeCloseTo(0, 0);
    expect(bearingDeg([80, 13], [80.01, 13])).toBeCloseTo(90, 0);
    expect(bearingDeg([80, 13], [80, 12.99])).toBeCloseTo(180, 0);
    expect(bearingDeg([80, 13], [79.99, 13])).toBeCloseTo(270, 0);
  });

  it("maps the direction of travel to the arm it came from", () => {
    expect(armForBearing(0)).toBe(1); // heading north: waits on the south arm
    expect(armForBearing(90)).toBe(3); // heading east: west arm
    expect(armForBearing(180)).toBe(0); // heading south: north arm
    expect(armForBearing(270)).toBe(2); // heading west: east arm
    expect(armForBearing(359)).toBe(1);
    expect(armForBearing(44)).toBe(1);
    expect(armForBearing(45)).toBe(3);
  });

  it("finds the arm from the stretch before the junction", () => {
    // Driving east along latitude 13, past a junction at longitude 80.05.
    const east = junctionsAlongRoute(line, [{ id: 1, name: "A", lat: 13.0001, lng: 80.05 }]);
    expect(east[0]!.arm).toBe(3);
    // The same road driven the other way arrives on the east arm.
    const west = junctionsAlongRoute([...line].reverse(), [
      { id: 1, name: "A", lat: 13.0001, lng: 80.05 },
    ]);
    expect(west[0]!.arm).toBe(2);
  });

  it("has no arm when the route starts at the junction", () => {
    const start = junctionsAlongRoute(line, [{ id: 1, name: "A", lat: 13.0, lng: 80.0 }]);
    expect(start[0]!.arm).toBeNull();
  });

  it("charges the wait of the arm used, not the junction average", () => {
    const route: OsrmRoute = { coordinates: line, distanceM: 10_000, durationSec: 900 };
    const base = forecastNetwork(istDate(18, 30)).find((f) => f.junctionId === 1)!;
    const lopsided = {
      ...base,
      approachDelayAdaptive: [10, 70, 20, 30],
      approachDelayFixed: [15, 80, 25, 40],
    };
    const price = (arm: 0 | 1 | 2 | 3 | null) =>
      assessRoute(
        route,
        [{ junctionId: 1, name: "A", arm, alongM: 500, offM: 5 }],
        new Map([[1, lopsided]]),
      );
    expect(price(1).signalAdaptiveSec).toBe(70);
    expect(price(1).signalFixedSec).toBe(80);
    expect(price(0).signalAdaptiveSec).toBe(10);
    expect(price(null).signalAdaptiveSec).toBe(Math.round(base.delayAdaptive));
  });
});

describe("fetchOsrmRoutes", () => {
  const ok = (body: unknown) =>
    (async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;

  it("parses routes from the service", async () => {
    const routes = await fetchOsrmRoutes(
      [80, 13],
      [80.1, 13],
      undefined,
      ok({
        code: "Ok",
        routes: [
          {
            distance: 1000,
            duration: 120,
            geometry: {
              coordinates: [
                [80, 13],
                [80.1, 13],
              ],
            },
          },
        ],
      }),
    );
    expect(routes).toEqual([
      {
        coordinates: [
          [80, 13],
          [80.1, 13],
        ],
        distanceM: 1000,
        durationSec: 120,
      },
    ]);
  });

  it("throws when there is no route or the service fails", async () => {
    await expect(
      fetchOsrmRoutes([0, 0], [1, 1], undefined, ok({ code: "NoRoute" })),
    ).rejects.toThrow(/No route/);
    const down = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    await expect(fetchOsrmRoutes([0, 0], [1, 1], undefined, down)).rejects.toThrow(/503/);
  });

  it("tells apart a missing route, a busy service and an unreachable one", async () => {
    const busy = (async () => ({ ok: false, status: 429 })) as unknown as typeof fetch;
    await expect(fetchOsrmRoutes([0, 0], [1, 1], undefined, busy)).rejects.toMatchObject({
      kind: "busy",
    });
    await expect(
      fetchOsrmRoutes([0, 0], [1, 1], undefined, ok({ code: "NoRoute" })),
    ).rejects.toMatchObject({ kind: "no-route" });
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(fetchOsrmRoutes([0, 0], [1, 1], undefined, offline)).rejects.toMatchObject({
      kind: "unreachable",
    });
  });

  it("rethrows the caller's own abort so it is not reported as an outage", async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = (async () => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    await expect(fetchOsrmRoutes([0, 0], [1, 1], controller.signal, aborted)).rejects.toMatchObject(
      { name: "AbortError" },
    );
  });

  it("falls back to a labelled straight-line estimate", () => {
    const r = straightLineRoute([80, 13], [80.1, 13]);
    expect(r.coordinates).toHaveLength(2);
    expect(r.durationSec).toBeGreaterThan(0);
  });
});

describe("formatting", () => {
  it("prints minutes and kilometres", () => {
    expect(formatMinutes(30)).toBe("30 s");
    expect(formatMinutes(0)).toBe("0 s");
    expect(formatMinutes(75)).toBe("1 min");
    expect(formatMinutes(25 * 60)).toBe("25 min");
    expect(formatMinutes(95 * 60)).toBe("1 h 35 min");
    expect(formatKm(4200)).toBe("4.2 km");
    expect(formatKm(23_400)).toBe("23 km");
  });
});
