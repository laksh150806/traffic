import { describe, expect, it } from "vitest";
import { forecastNetwork, istDate } from "@/lib/forecast";
import {
  assessRoute,
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
    const here = [{ junctionId: 1, name: "A", alongM: 100, offM: 10 }];
    const a = assessRoute(route, here, peak);
    expect(a.driveSec).toBe(900);
    expect(a.signalAdaptiveSec).toBe(Math.round(peak.get(1)!.delayAdaptive));
    expect(a.etaAdaptiveSec).toBe(900 + a.signalAdaptiveSec);
    expect(a.worst?.junctionId).toBe(1);
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

  it("falls back to a labelled straight-line estimate", () => {
    const r = straightLineRoute([80, 13], [80.1, 13]);
    expect(r.coordinates).toHaveLength(2);
    expect(r.durationSec).toBeGreaterThan(0);
  });
});

describe("formatting", () => {
  it("prints minutes and kilometres", () => {
    expect(formatMinutes(30)).toBe("1 min");
    expect(formatMinutes(25 * 60)).toBe("25 min");
    expect(formatMinutes(95 * 60)).toBe("1 h 35 min");
    expect(formatKm(4200)).toBe("4.2 km");
    expect(formatKm(23_400)).toBe("23 km");
  });
});
