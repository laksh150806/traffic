// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveEta } from "@/components/ops/useLiveEta";
import { useLiveTraffic } from "@/components/ops/useLiveTraffic";
import { useLiveWeather } from "@/components/ops/useLiveWeather";
import { getRealTraffic, resetSimEngine, setRealTraffic } from "@/lib/sim-engine";
import { getWeather, setWeather } from "@/lib/weather";
import type { TrafficSnapshot } from "@/lib/traffic-flow";
import { stubBrowser } from "@/test-utils/dom";

stubBrowser();

const snapshot = (ratio: number | null = 0.8): TrafficSnapshot => ({
  enabled: true,
  fetchedAtMs: Date.now(),
  source: "tomtom",
  tilesOk: 4,
  tilesTotal: 4,
  junctions: [
    { id: 1, ratio, samples: ratio === null ? 0 : 3, nearestM: 10 },
    { id: 2, ratio, samples: ratio === null ? 0 : 3, nearestM: 10 },
  ],
});

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.useFakeTimers();
  resetSimEngine(1);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setRealTraffic(null);
  setWeather(null);
});

describe("useLiveTraffic", () => {
  it("goes live and hands the reading to the simulation", async () => {
    vi.stubGlobal("fetch", respond(snapshot()));
    const onUpdate = vi.fn();
    const { result } = renderHook(() => useLiveTraffic(true, onUpdate));
    expect(result.current.status).toBe("loading");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.status).toBe("live");
    expect(getRealTraffic()?.flows.size).toBe(2);
    expect(onUpdate).toHaveBeenCalled();
  });

  it("says off when the server has no key, and leaves the simulation alone", async () => {
    vi.stubGlobal("fetch", respond({ enabled: false }));
    const { result } = renderHook(() => useLiveTraffic(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.status).toBe("off");
    expect(getRealTraffic()).toBeNull();
  });

  it("says off for a reading in which no junction found a road", async () => {
    vi.stubGlobal("fetch", respond(snapshot(null)));
    const { result } = renderHook(() => useLiveTraffic(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.status).toBe("off");
  });

  it("keeps the last reading, marked stale, when a later one fails", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(snapshot())))
      .mockResolvedValue(new Response("no", { status: 502 }));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useLiveTraffic(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.status).toBe("live");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(95_000);
    });
    expect(result.current.status).toBe("stale");
    expect(getRealTraffic()?.flows.size).toBe(2);
  });

  it("does nothing when switched off, and asks again about every 90 seconds", async () => {
    const fetcher = respond(snapshot());
    vi.stubGlobal("fetch", fetcher);
    renderHook(() => useLiveTraffic(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200_000);
    });
    expect(fetcher).not.toHaveBeenCalled();

    renderHook(() => useLiveTraffic(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(185_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe("useLiveWeather", () => {
  const body = {
    current: { time: Math.floor(Date.now() / 1000), temperature_2m: 30, precipitation: 3 },
    hourly: { time: [Math.floor(Date.now() / 1000) + 3600], precipitation: [3] },
  };

  it("stores the weather for the simulation and tells the page", async () => {
    vi.stubGlobal("fetch", respond(body));
    const onChange = vi.fn();
    const { result } = renderHook(() => useLiveWeather(true, onChange));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current?.current.precipMm).toBe(3);
    expect(getWeather()?.current.tempC).toBe(30);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps what it has when the service cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    );
    const { result } = renderHook(() => useLiveWeather(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current).toBeNull();
    expect(getWeather()).toBeNull();
  });
});

describe("useLiveEta", () => {
  const eta = { lengthM: 12000, travelSec: 1230, freeFlowSec: 1412, delaySec: 0, fetchedAtMs: 1 };
  const a = { lat: 13.0067, lng: 80.2206 };
  const b = { lat: 13.0817, lng: 80.2766 };

  it("asks for the trip and holds the answer", async () => {
    const fetcher = respond(eta);
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useLiveEta(a, b, true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current?.travelSec).toBe(1230);
    const asked = String((fetcher.mock.calls[0] as unknown[])[0]);
    expect(asked).toContain("/api/route-eta?from=13.00670%2C80.22060");
  });

  it("does not ask without a trip or when real traffic is off", async () => {
    const fetcher = respond(eta);
    vi.stubGlobal("fetch", fetcher);
    renderHook(() => useLiveEta(null, b, true));
    renderHook(() => useLiveEta(a, b, false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200_000);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stays empty when the answer is not a trip", async () => {
    vi.stubGlobal("fetch", respond({ enabled: false }));
    const { result } = renderHook(() => useLiveEta(a, b, true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current).toBeNull();
  });
});
