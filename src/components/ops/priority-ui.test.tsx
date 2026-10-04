// @vitest-environment jsdom
/**
 * The operator and emergency-vehicle pieces, as a person meets them: what is shown, and what a
 * click asks the engine to do.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CityBoard } from "@/components/ops/CityBoard";
import { TimeSpaceDiagram } from "@/components/ops/GreenWavePanel";
import { RunStatus } from "@/components/ops/RunStatus";
import { RoadList, type RoadControls } from "@/components/traffic/RoadList";
import type { PriorityRunStatus } from "@/lib/sim-engine";
import type { RoadState } from "@/lib/traffic-types";
import { stubBrowser } from "@/test-utils/dom";

stubBrowser();
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const status = (over: Partial<PriorityRunStatus> = {}): PriorityRunStatus => ({
  kind: "ambulance",
  label: "Ambulance to Apollo",
  progressM: 1500,
  totalM: 6000,
  etaSec: 205,
  speedFactor: 1,
  finished: false,
  coordinates: [
    [80.2, 13],
    [80.25, 13.05],
  ],
  position: [80.21, 13.01],
  stops: [
    {
      junctionId: 1,
      name: "Adyar Signal",
      roadId: 1,
      alongM: 400,
      phase: "passed",
      heldVehicles: 12,
      normalWaitSec: 30,
    },
    {
      junctionId: 2,
      name: "Guindy",
      roadId: 5,
      alongM: 1500,
      phase: "clearing",
      heldVehicles: 20,
      normalWaitSec: 45,
    },
    {
      junctionId: 3,
      name: "Saidapet",
      roadId: 9,
      alongM: 3200,
      phase: "ahead",
      heldVehicles: 0,
      normalWaitSec: 0,
    },
  ],
  savedSec: 75,
  heldVehicles: 32,
  passed: 1,
  ...over,
});

describe("RunStatus", () => {
  it("says where the vehicle is, what it has cleared and what it cost the side roads", () => {
    render(<RunStatus status={status()} onCancel={() => {}} />);
    expect(screen.getByText("Ambulance to Apollo")).toBeTruthy();
    expect(screen.getByText(/Green at Guindy/)).toBeTruthy();
    expect(screen.getByText("Signals cleared").previousElementSibling?.textContent).toMatch(
      /1\s*\/\s*3/,
    );
    expect(screen.getByText("Wait avoided").previousElementSibling?.textContent).toMatch(/75/);
    expect(screen.getByText("Held on side roads").previousElementSibling?.textContent).toBe("32");
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  });

  it("offers Cancel while running and Done when it has finished", () => {
    const onCancel = vi.fn();
    const { rerender } = render(<RunStatus status={status()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(
      <RunStatus
        status={status({ finished: true, progressM: 6000, etaSec: 0 })}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("button", { name: /Done/ })).toBeTruthy();
    expect(screen.getByText(/Reached the end/)).toBeTruthy();
  });

  it("says so when no modelled signal is on the route", () => {
    render(<RunStatus status={status({ stops: [], passed: 0 })} onCancel={() => {}} />);
    expect(screen.getByText(/nothing needed clearing/)).toBeTruthy();
  });
});

describe("TimeSpaceDiagram", () => {
  const stop = (junctionId: number, name: string, alongM: number) => ({
    junctionId,
    name,
    roadId: junctionId * 4,
    alongM,
  });

  it("names its signals and describes the stops in its label", () => {
    render(
      <TimeSpaceDiagram
        projection={{
          rows: [
            {
              stop: stop(1, "Adyar Signal", 300),
              windows: [{ startSec: 4, endSec: 30 }],
              arriveSec: 20,
              waitSec: 0,
            },
            {
              stop: stop(2, "Guindy Junction", 900),
              windows: [{ startSec: 70, endSec: 100 }],
              arriveSec: 60,
              waitSec: 10,
            },
          ],
          track: [
            { t: 0, x: 0 },
            { t: 20, x: 300 },
            { t: 60, x: 900 },
            { t: 70, x: 900 },
          ],
          stopsMade: 1,
          waitSec: 10,
          horizonSec: 300,
        }}
      />,
    );
    const figure = screen.getByRole("img");
    expect(figure.getAttribute("aria-label")).toMatch(/2 signals.*1 stops.*10 seconds/);
    expect(screen.getAllByText("Adyar Signal").length).toBeGreaterThan(0);
    // One amber dot, where the car waits.
    expect(figure.querySelectorAll("circle")).toHaveLength(1);
  });
});

describe("CityBoard", () => {
  it("lists what is going on and counts the active holds, problems and runs", () => {
    render(
      <CityBoard
        stats={[]}
        loading={false}
        saved={{ seconds: 7200, windowMin: 30 }}
        adaptiveDelay={70}
        fixedDelay={90}
        activity={{
          run: status(),
          overrides: [{ junctionId: 1, roadId: 1, sinceMs: 0, untilMs: Date.now() + 60_000 }],
          incidents: [{ roadId: 9, kind: "accident", untilMs: Date.now() + 60_000 }],
          events: [
            {
              atMs: Date.now() - 4000,
              text: "Operator gave North the green at Adyar",
              tone: "warn",
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(/Operator gave North the green at Adyar/)).toBeTruthy();
    expect(screen.getByText(/1 operator hold/)).toBeTruthy();
    expect(screen.getByText(/1 reported problem/)).toBeTruthy();
    expect(screen.getByText(/Ambulance to Apollo: 1 of 3 signals/)).toBeTruthy();
    expect(screen.getByText(/vehicle-hours/)).toBeTruthy();
  });

  it("summarises real road speed and names the slowest junction, with the credits", () => {
    render(
      <CityBoard
        stats={[]}
        loading={false}
        saved={undefined}
        adaptiveDelay={undefined}
        fixedDelay={undefined}
        activity={{ run: null, overrides: [], incidents: [], events: [] }}
        liveTraffic={{
          status: "live",
          snapshot: {
            enabled: true,
            fetchedAtMs: Date.now(),
            source: "tomtom",
            tilesOk: 4,
            tilesTotal: 4,
            junctions: [
              { id: 1, ratio: 0.5, samples: 3, nearestM: 5 },
              { id: 2, ratio: 0.9, samples: 3, nearestM: 5 },
              { id: 3, ratio: null, samples: 0, nearestM: null },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("Real road speed, TomTom")).toBeTruthy();
    expect(screen.getByText(/of free-flow speed, 2 junctions/)).toBeTruthy();
    expect(screen.getByText(/Slowest: Tambaram Junction at 50%/)).toBeTruthy();
    expect(screen.getByText(/Real traffic, TomTom/)).toBeTruthy();
    expect(screen.getByText(/Traffic data/)).toBeTruthy();
  });

  it("shows an empty activity feed without invented entries", () => {
    render(
      <CityBoard
        stats={[]}
        loading={false}
        saved={undefined}
        adaptiveDelay={undefined}
        fixedDelay={undefined}
        activity={{ run: null, overrides: [], incidents: [], events: [] }}
      />,
    );
    expect(screen.getByText(/Nothing yet/)).toBeTruthy();
  });
});

describe("RoadList operator controls", () => {
  const NOW = Date.now();
  const road = (id: number, direction: string, green: boolean): RoadState => ({
    road_id: id,
    direction,
    road_name: `${direction} Road`,
    max_capacity: 120,
    vehicle_count: 20,
    source: "SIMULATED_SENSOR",
    recorded_at: null,
    green_duration_sec: 30,
    timing_mode: "ADAPTIVE",
    is_currently_green: green,
    phase_started_at: new Date(NOW - 60_000).toISOString(),
  });
  const roads = [
    road(1, "NORTH", true),
    road(2, "SOUTH", false),
    road(3, "EAST", false),
    road(4, "WEST", false),
  ];
  const controls = (over: Partial<RoadControls> = {}): RoadControls => ({
    override: null,
    incidents: new Map(),
    onGive: vi.fn(),
    onRelease: vi.fn(),
    onReport: vi.fn(),
    onClearReport: vi.fn(),
    ...over,
  });

  it("asks for the green on the approach whose button was pressed", () => {
    const c = controls();
    render(<RoadList roads={roads} loading={false} controls={c} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Give green/ })[1] as HTMLElement);
    expect(c.onGive).toHaveBeenCalledWith(2);
  });

  it("reports an accident or road works on that approach", () => {
    const c = controls();
    render(<RoadList roads={roads} loading={false} controls={c} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Report accident/ })[2] as HTMLElement);
    expect(c.onReport).toHaveBeenCalledWith(3, "accident");
    fireEvent.click(screen.getAllByRole("button", { name: /Road works/ })[0] as HTMLElement);
    expect(c.onReport).toHaveBeenCalledWith(1, "works");
  });

  it("shows an override banner and lets the operator release it", () => {
    const c = controls({
      override: { junctionId: 1, roadId: 3, sinceMs: NOW, untilMs: NOW + 45_000 },
    });
    render(<RoadList roads={roads} loading={false} controls={c} />);
    expect(screen.getByText(/Operator override/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Release now" }));
    expect(c.onRelease).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Holding green/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("offers a way to clear a reported problem", () => {
    const c = controls({
      incidents: new Map([[2, { roadId: 2, kind: "works" as const, untilMs: NOW + 90_000 }]]),
    });
    render(<RoadList roads={roads} loading={false} controls={c} />);
    fireEvent.click(screen.getByRole("button", { name: /Road works 1:\d\d, clear/ }));
    expect(c.onClearReport).toHaveBeenCalledWith(2);
  });

  it("shows no controls when none are given", () => {
    render(<RoadList roads={roads} loading={false} />);
    expect(screen.queryByRole("button", { name: /Give green/ })).toBeNull();
  });
});
