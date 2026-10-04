// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_AGE_MS,
  MAX_SAMPLES,
  clearSpeedHistory,
  recordSnapshot,
  speedHistory,
} from "@/lib/traffic-history";
import type { TrafficSnapshot } from "@/lib/traffic-flow";

const snap = (at: number, ratios: Array<number | null>): TrafficSnapshot => ({
  enabled: true,
  fetchedAtMs: at,
  source: "tomtom",
  tilesOk: 1,
  tilesTotal: 1,
  junctions: ratios.map((ratio, i) => ({
    id: i + 1,
    ratio,
    samples: ratio === null ? 0 : 1,
    nearestM: 5,
  })),
});

beforeEach(() => clearSpeedHistory());

describe("speed history", () => {
  it("keeps each junction's readings in order and skips those with none", () => {
    recordSnapshot(snap(1000, [0.9, null]));
    recordSnapshot(snap(2000, [0.7, 0.8]));
    expect(speedHistory(1)).toEqual([
      { t: 1000, ratio: 0.9 },
      { t: 2000, ratio: 0.7 },
    ]);
    expect(speedHistory(2)).toEqual([{ t: 2000, ratio: 0.8 }]);
    expect(speedHistory(99)).toEqual([]);
  });

  it("ignores the same reading arriving twice", () => {
    recordSnapshot(snap(1000, [0.9]));
    recordSnapshot(snap(1000, [0.9]));
    expect(speedHistory(1)).toHaveLength(1);
  });

  it("holds a limited number of readings, dropping the oldest", () => {
    for (let i = 0; i < MAX_SAMPLES + 20; i += 1) recordSnapshot(snap(1000 + i * 10, [0.5]));
    const kept = speedHistory(1);
    expect(kept).toHaveLength(MAX_SAMPLES);
    expect(kept[kept.length - 1]!.t).toBe(1000 + (MAX_SAMPLES + 19) * 10);
  });

  it("forgets readings that are too old", () => {
    recordSnapshot(snap(1000, [0.9]));
    recordSnapshot(snap(1000 + MAX_AGE_MS + 5000, [0.6]));
    expect(speedHistory(1)).toEqual([{ t: 1000 + MAX_AGE_MS + 5000, ratio: 0.6 }]);
  });

  it("is kept in the browser, so a reload does not lose it", () => {
    recordSnapshot(snap(1000, [0.9]));
    const stored = JSON.parse(localStorage.getItem("traffic-speed-history-v1") ?? "{}");
    expect(stored["1"]).toEqual([[1000, 0.9]]);
  });

  it("carries on when storage is blocked or full", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => recordSnapshot(snap(1000, [0.9]))).not.toThrow();
    expect(speedHistory(1)).toHaveLength(1);
    setItem.mockRestore();
  });
});
