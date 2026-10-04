import { afterEach, describe, expect, it } from "vitest";
import {
  getRealTraffic,
  getScenarioCapacity,
  resetSimEngine,
  setRealTraffic,
  setScenarioMode,
  simAdvance,
  simFetchJunctions,
  simFetchRoadStates,
  simTick,
} from "@/lib/sim-engine";
import { junctionBaselineVC, RAIN_CAPACITY_FACTOR } from "@/lib/sim-core";
import type { TrafficSnapshot } from "@/lib/traffic-flow";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
import { snapToSignal, SNAP_MAX_M } from "@/lib/osm-snap";
import {
  LIGHT_RAIN_CAPACITY_FACTOR,
  capacityForRain,
  fetchWeather,
  parseWeather,
  rainAt,
  rainClass,
  setWeather,
  weatherCapacityAt,
  type WeatherSnapshot,
} from "@/lib/weather";

afterEach(() => {
  setWeather(null);
  setRealTraffic(null);
});

describe("snapping to real signals", () => {
  const signals: Array<readonly [number, number]> = [
    [13.0, 80.2],
    [13.01, 80.21],
  ];

  it("moves onto a signal within reach and reports how far it moved", () => {
    const snap = snapToSignal(13.0015, 80.2, signals);
    expect(snap).toMatchObject({ lat: 13.0, lng: 80.2, verified: true });
    expect(snap.offsetM).toBeGreaterThan(150);
    expect(snap.offsetM).toBeLessThan(180);
  });

  it("leaves a point alone, flagged, when no signal is near", () => {
    const snap = snapToSignal(13.05, 80.25, signals);
    expect(snap.verified).toBe(false);
    expect(snap.lat).toBe(13.05);
    expect(snap.offsetM).toBeGreaterThan(SNAP_MAX_M);
  });

  it("has checked every seed junction, and matched a good number of them", () => {
    const verified = SEED_JUNCTIONS.filter((j) => j.verified);
    expect(SEED_JUNCTIONS.every((j) => typeof j.verified === "boolean")).toBe(true);
    expect(verified.length).toBeGreaterThanOrEqual(20);
    expect(verified.every((j) => (j.offsetM ?? Infinity) <= SNAP_MAX_M)).toBe(true);
  });
});

describe("rain and capacity", () => {
  it("classifies hourly rain", () => {
    expect(rainClass(0)).toBe("dry");
    expect(rainClass(0.5)).toBe("light");
    expect(rainClass(2.5)).toBe("steady");
    expect(rainClass(12)).toBe("steady");
  });

  it("cuts capacity more as the rain gets heavier", () => {
    expect(capacityForRain(0)).toBe(1);
    expect(capacityForRain(1)).toBe(LIGHT_RAIN_CAPACITY_FACTOR);
    expect(capacityForRain(5)).toBe(RAIN_CAPACITY_FACTOR);
  });
});

describe("reading Open-Meteo", () => {
  const body = {
    current: { time: 1_800_000_000, temperature_2m: 29.5, precipitation: 0.4 },
    hourly: {
      time: [1_800_003_600, 1_800_007_200, 1_800_010_800],
      precipitation: [0, 3.2, null],
    },
  };

  it("turns a reply into milliseconds and skips missing hours", () => {
    const snap = parseWeather(body, 5)!;
    expect(snap.current).toEqual({ atMs: 1_800_000_000_000, precipMm: 0.4, tempC: 29.5 });
    expect(snap.hourly).toEqual([
      { atMs: 1_800_003_600_000, precipMm: 0 },
      { atMs: 1_800_007_200_000, precipMm: 3.2 },
    ]);
  });

  it("refuses a reply that is not in the expected shape", () => {
    expect(parseWeather(null, 0)).toBeNull();
    expect(parseWeather({ current: { time: 1 } }, 0)).toBeNull();
    expect(parseWeather({ ...body, hourly: { time: [], precipitation: [] } }, 0)).toBeNull();
  });

  it("asks for what it needs and returns null on an error status", async () => {
    let asked = "";
    const ok = (async (url: string | URL | Request) => {
      asked = String(url);
      return new Response(JSON.stringify(body));
    }) as typeof fetch;
    expect((await fetchWeather(ok, 7))?.fetchedAtMs).toBe(7);
    expect(asked).toContain("api.open-meteo.com");
    expect(asked).toContain("timeformat=unixtime");
    const bad = (async () => new Response("no", { status: 429 })) as typeof fetch;
    expect(await fetchWeather(bad, 7)).toBeNull();
  });

  it("uses the current reading for now and the hourly figures for later", () => {
    const snap: WeatherSnapshot = parseWeather(body, 0)!;
    setWeather(snap);
    expect(rainAt(1_800_000_000_000 + 10 * 60_000)).toBe(0.4);
    // Two hours on, the hour ending at +2 h held 3.2 mm.
    expect(rainAt(1_800_000_000_000 + 3600_000 + 60_000)).toBe(3.2);
    expect(weatherCapacityAt(1_800_000_000_000 + 3600_000 + 60_000)).toBe(RAIN_CAPACITY_FACTOR);
    // Far beyond the forecast there is nothing to go on.
    expect(rainAt(1_800_000_000_000 + 40 * 3600_000)).toBeNull();
  });

  it("has no effect without weather", () => {
    setWeather(null);
    expect(weatherCapacityAt(Date.now())).toBe(1);
  });
});

describe("the engine and real weather", () => {
  const wet = (mm: number): WeatherSnapshot => ({
    fetchedAtMs: Date.now(),
    current: { atMs: Date.now(), precipMm: mm, tempC: 28 },
    hourly: [{ atMs: Date.now() + 3600_000, precipMm: mm }],
  });

  it("follows real rain while the scenario follows the clock", () => {
    resetSimEngine(3);
    setWeather(wet(6));
    expect(getScenarioCapacity()).toBe(RAIN_CAPACITY_FACTOR);
    setWeather(wet(1));
    expect(getScenarioCapacity()).toBe(LIGHT_RAIN_CAPACITY_FACTOR);
  });

  it("ignores real rain in a made-up scenario", () => {
    resetSimEngine(3);
    setWeather(wet(6));
    setScenarioMode("rush");
    expect(getScenarioCapacity()).toBe(1);
    setScenarioMode("rain");
    expect(getScenarioCapacity()).toBe(RAIN_CAPACITY_FACTOR);
  });
});

describe("the engine and real traffic", () => {
  const snapshot = (
    ratio: number | null,
    over: Partial<TrafficSnapshot> = {},
  ): TrafficSnapshot => ({
    enabled: true,
    fetchedAtMs: Date.now(),
    source: "tomtom",
    tilesOk: 4,
    tilesTotal: 4,
    junctions: SEED_JUNCTIONS.map((j) => ({
      id: j.id,
      ratio,
      samples: ratio === null ? 0 : 3,
      nearestM: 20,
    })),
    ...over,
  });

  /** Total queued vehicles across the network after a few minutes of ticks. */
  const settle = (ratio: number | null) => {
    resetSimEngine(21);
    simTick(Date.now() + 1000); // build the world on the assumed curve
    setRealTraffic(snapshot(ratio));
    let clock = Date.now() + 1000;
    for (let i = 0; i < 25; i += 1) {
      clock += 12_000;
      simTick(clock);
      for (let k = 1; k <= 6; k += 1) simAdvance(clock + k * 2000);
    }
    return simFetchJunctions().reduce((sum, j) => sum + j.total_vehicle_count, 0);
  };

  it("makes the network heavier when the real roads are slow than when they are free", () => {
    const jammed = settle(0.45);
    const free = settle(1);
    expect(jammed).toBeGreaterThan(free * 1.5);
  });

  it("never makes a quiet hour busier because the roads are free flowing", () => {
    // Free-flow speed cannot say how empty a road is, only that it is not near capacity.
    const assumed = settle(null);
    const free = settle(1);
    expect(free).toBeLessThanOrEqual(assumed * 1.02);
  });

  it("reports what it was given and whether it is recent enough to use", () => {
    resetSimEngine(1);
    expect(getRealTraffic()).toBeNull();
    setRealTraffic(snapshot(0.7));
    expect(getRealTraffic()?.fresh).toBe(true);
    expect(getRealTraffic(Date.now() + 11 * 60_000)?.fresh).toBe(false);
    expect(getRealTraffic()?.flows.size).toBe(69);
    setRealTraffic(null);
    expect(getRealTraffic()).toBeNull();
  });

  it("is ignored in a made-up scenario, and when the server has no key", () => {
    resetSimEngine(1);
    setRealTraffic(snapshot(0.5));
    setScenarioMode("rush");
    expect(getRealTraffic()?.fresh).toBe(false);
    setScenarioMode("auto");
    setRealTraffic({ ...snapshot(0.5), enabled: false });
    expect(getRealTraffic()).toBeNull();
  });

  it("skips junctions with no reading and keeps them on the assumed curve", () => {
    const withGap = snapshot(0.5);
    withGap.junctions[0] = { id: SEED_JUNCTIONS[0]!.id, ratio: null, samples: 0, nearestM: null };
    resetSimEngine(5);
    simTick(Date.now() + 1000);
    setRealTraffic(withGap);
    expect(getRealTraffic()?.flows.get(SEED_JUNCTIONS[0]!.id)?.ratio).toBeNull();
    expect(simFetchRoadStates(SEED_JUNCTIONS[0]!.id)).toHaveLength(4);
  });

  it("keeps the baseline volume over capacity in step with the demand factor", () => {
    expect(junctionBaselineVC(0, 1.15)).toBeGreaterThan(0);
    expect(junctionBaselineVC(0, 2.3)).toBeCloseTo(junctionBaselineVC(0, 1.15) * 2, 5);
  });
});
