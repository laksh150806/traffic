// @vitest-environment jsdom
/**
 * Behaviour of the interactive pieces, checked as a person meets them: through roles and labels
 * rather than class names. One file, because starting a browser-like environment is the slow part.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Attention } from "@/components/ops/Attention";
import { TourCaption } from "@/components/ops/GuidedTour";
import { ReplayPanel } from "@/components/ops/ReplayPanel";
import { SearchBox } from "@/components/ops/SearchBox";
import { TimeBar } from "@/components/ops/TimeBar";
import { useGuidedTour, type TourControls } from "@/components/ops/useGuidedTour";
import { RoadList } from "@/components/traffic/RoadList";
import { findPeaks, forecastNetwork } from "@/lib/forecast";
import type { JunctionSummary, RoadState } from "@/lib/traffic-types";
import { stubBrowser } from "@/test-utils/dom";

stubBrowser();
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const at = (day: number, hour: number) =>
  new Date(Date.UTC(2026, 9, day) + (hour - 5.5) * 3600_000);

const junction = (
  id: number,
  name: string,
  level: JunctionSummary["congestion_level"] = "LOW",
  zone = "Central",
): JunctionSummary => ({
  junction_id: id,
  name,
  zone,
  latitude: 13,
  longitude: 80.2,
  avg_vehicle_count: 0,
  total_vehicle_count: 0,
  congestion_level: level,
  last_reading_at: null,
});

describe("TimeBar", () => {
  const render_ = (now: Date, offsetMin = 0, onChange = vi.fn()) => {
    render(<TimeBar now={now} clock={now} offsetMin={offsetMin} onChange={onChange} />);
    return onChange;
  };

  it("offers the commuter peaks on a working day and jumps to them", () => {
    const now = at(5, 6); // Monday 6 am
    const onChange = render_(now);
    const peaks = findPeaks(now);
    fireEvent.click(screen.getByRole("button", { name: /Morning peak/ }));
    expect(onChange).toHaveBeenLastCalledWith(peaks.morning);
    fireEvent.click(screen.getByRole("button", { name: /Evening peak/ }));
    expect(onChange).toHaveBeenLastCalledWith(peaks.evening);
  });

  it("names the peaks for what they are on a weekend", () => {
    render_(at(3, 6)); // Saturday 6 am
    expect(screen.getByRole("button", { name: /Midday peak/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Evening peak/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Morning peak/ })).toBeNull();
  });

  it("puts the chosen time in each chip's name", () => {
    render_(at(5, 6));
    expect(screen.getByRole("button", { name: /Morning peak, \d{1,2}:\d{2} am/ })).toBeTruthy();
  });

  it("only offers 'Now' when looking ahead, and the slider reports minutes", () => {
    const onChange = render_(at(5, 6));
    expect((screen.getByRole("button", { name: /Now/ }) as HTMLButtonElement).disabled).toBe(true);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "120" } });
    expect(onChange).toHaveBeenCalledWith(120);
    cleanup();
    render_(at(5, 6), 90);
    expect((screen.getByRole("button", { name: /Now/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/Forecast/)).toBeTruthy();
  });
});

describe("SearchBox", () => {
  const items = [
    junction(1, "Tambaram Junction", "LOW", "GST Corridor"),
    junction(2, "Kathipara Junction", "HIGH"),
    junction(3, "Guindy Signal", "MODERATE"),
  ];

  const setup = () => {
    const onPick = vi.fn();
    render(
      <SearchBox junctions={items} label="Search junctions" placeholder="Search" onPick={onPick} />,
    );
    return { onPick, input: screen.getByRole("combobox", { name: "Search junctions" }) };
  };

  it("shows nothing until something is typed, then lists matches", () => {
    const { input } = setup();
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.change(input, { target: { value: "g" } });
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Guindy Signal"),
      expect.stringContaining("Tambaram"),
    ]);
  });

  it("keeps aria-activedescendant on the option the arrow keys reach", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "junction" } });
    const options = screen.getAllByRole("option");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]!.id);
    expect(options[1]!.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("picks the highlighted option on Enter and clears the box", () => {
    const { input, onPick } = setup();
    fireEvent.change(input, { target: { value: "junction" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    // "junction" matches Kathipara and Tambaram equally, so they come in name order.
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ junction_id: 1 }));
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("closes on Escape without picking", () => {
    const { input, onPick } = setup();
    fireEvent.change(input, { target: { value: "kath" } });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("Attention", () => {
  it("lists only junctions that are not flowing, worst first, and selects on click", () => {
    const all = [
      junction(1, "Calm Place", "LOW"),
      junction(2, "Busy Place", "MODERATE"),
      junction(3, "Jammed Place", "HIGH"),
    ];
    const forecast = new Map(forecastNetwork(at(5, 9)).map((f) => [f.junctionId, f]));
    const onSelect = vi.fn();
    render(<Attention junctions={all} forecast={forecast} selectedId={null} onSelect={onSelect} />);
    expect(screen.queryByText("Calm Place")).toBeNull();
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]!.textContent).toContain("Jammed Place");
    expect(buttons[1]!.textContent).toContain("Busy Place");
    fireEvent.click(buttons[0]!);
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("says so when everything is flowing", () => {
    render(
      <Attention
        junctions={[junction(1, "Calm Place")]}
        forecast={new Map()}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText(/flowing freely/)).toBeTruthy();
  });
});

describe("RoadList signal heads", () => {
  const NOW = Date.UTC(2026, 9, 5, 4, 0, 0);
  const road = (
    id: number,
    direction: string,
    green: boolean,
    startedAgoSec: number,
  ): RoadState => ({
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
    phase_started_at: new Date(NOW - startedAgoSec * 1000).toISOString(),
  });
  const handover = () => [
    road(1, "NORTH", false, 1), // lost the green a second ago
    road(2, "EAST", true, 1), // was just given it
    road(3, "SOUTH", false, 90),
    road(4, "WEST", false, 40),
  ];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
  });

  const lamp = (direction: string) =>
    screen.getByText(direction).closest("div[class*='glass-inset']")!.querySelector("[role=img]")!;

  it("shows amber on the approach that just lost the green and holds the new one at red", () => {
    render(<RoadList roads={handover()} loading={false} />);
    expect(lamp("NORTH").getAttribute("aria-label")).toBe("Amber");
    expect(lamp("EAST").getAttribute("aria-label")).toBe("Red, green is about to start");
    expect(lamp("SOUTH").getAttribute("aria-label")).toBe("Red");
    expect(screen.getByText("Green starting")).toBeTruthy();
  });

  it("turns green once the clearance has passed", () => {
    render(<RoadList roads={handover()} loading={false} />);
    act(() => {
      vi.setSystemTime(NOW + 5000);
      vi.advanceTimersByTime(1000);
    });
    expect(lamp("EAST").getAttribute("aria-label")).toBe("Green now");
    expect(lamp("NORTH").getAttribute("aria-label")).toBe("Red");
    expect(screen.queryByText("Green starting")).toBeNull();
  });

  it("shows loading and empty states", () => {
    const { rerender } = render(<RoadList roads={[]} loading={true} />);
    expect(screen.queryByText(/No approaches/)).toBeNull();
    rerender(<RoadList roads={[]} loading={false} />);
    expect(screen.getByText(/No approaches configured/)).toBeTruthy();
  });
});

describe("ReplayPanel", () => {
  it("states the comparison in words and in the chart's name", () => {
    render(
      <ReplayPanel
        junctionId={10}
        startMs={at(5, 9).getTime()}
        factor={undefined}
        capacityScale={undefined}
        blocked={false}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /Replay: fixed timer against adaptive/ }),
    ).toBeTruthy();
    expect(screen.getByText(/shorter wait|longer wait|About the same/)).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /Average wait per vehicle \d+ seconds with the fixed/ }),
    ).toBeTruthy();
    expect(screen.getByText(/Traffic is simulated/)).toBeTruthy();
  });

  it("renders nothing for a junction it does not know", () => {
    const { container } = render(
      <ReplayPanel
        junctionId={9999}
        startMs={Date.now()}
        factor={undefined}
        capacityScale={undefined}
        blocked={false}
      />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("guided tour", () => {
  const BASE = at(5, 23); // Monday 11 pm, so the next 24 hours include Tuesday's rush

  function Harness({ controls }: { controls: TourControls }) {
    const tour = useGuidedTour(controls);
    const [started, setStarted] = useState(false);
    return (
      <div>
        <button
          onClick={() => {
            setStarted(true);
            void tour.start();
          }}
        >
          start
        </button>
        <button onClick={tour.stop}>stop</button>
        <span data-testid="state">{String(tour.active)}</span>
        <span data-testid="started">{String(started)}</span>
        {tour.caption ? <TourCaption caption={tour.caption} onStop={tour.stop} /> : null}
      </div>
    );
  }

  const makeControls = () => {
    const snapshot = vi.fn((ms: number) => ({
      jammed: ms > BASE.getTime() + 8 * 3600_000 ? 12 : 0,
      busy: 3,
      total: 69,
      worst: { id: 24, name: "Chennai Central Junction", zone: "North" },
    }));
    const setTime = vi.fn<(ms: number | null) => void>();
    const select = vi.fn<(id: number) => void>();
    const replay = vi.fn<TourControls["replay"]>(() => ({
      waitFixed: 100,
      waitAdaptive: 60,
      percent: 40,
    }));
    const showTrip = vi.fn<(from: number, to: number) => void>();
    const clearTrip = vi.fn<() => void>();
    const controls: TourControls = {
      base: BASE,
      reducedMotion: true,
      setTime,
      snapshot,
      select,
      replay,
      showTrip,
      clearTrip,
    };
    return { controls, setTime, select, replay, showTrip, clearTrip };
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("starts at the present, then steps through the next day and stops at the peaks", async () => {
    const m = makeControls();
    const controls = m.controls;
    render(<Harness controls={controls} />);
    fireEvent.click(screen.getByText("start"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("state").textContent).toBe("true");
    expect(m.setTime).toHaveBeenCalledWith(null);
    expect(screen.getByText(/69 signalised junctions/)).toBeTruthy();

    // Intro (3.6 s), then the sweep. Run it far enough to pass both peaks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_700 + 60_000);
    });
    const peaks = findPeaks(BASE);
    const times = m.setTime.mock.calls.map((c) => c[0] as number | null);
    expect(times).toContain(BASE.getTime() + peaks.morning * 60_000);
    // Each stop selects the worst junction and asks for a replay there.
    expect(m.select).toHaveBeenCalledWith(24);
    expect(m.replay).toHaveBeenCalledWith(24, BASE.getTime() + peaks.morning * 60_000);
    // Times never run backwards while sweeping.
    const sweep = times.filter((t): t is number => typeof t === "number");
    expect(sweep.slice(0, 5)).toEqual([...sweep.slice(0, 5)].sort((a, b) => a - b));
  });

  it("finishes by pricing a trip, clearing it, and returning to now", async () => {
    const m = makeControls();
    const controls = m.controls;
    render(<Harness controls={controls} />);
    fireEvent.click(screen.getByText("start"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(m.showTrip).toHaveBeenCalledWith(1, 69);
    expect(m.clearTrip).toHaveBeenCalled();
    expect(m.setTime).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId("state").textContent).toBe("false");
  });

  it("sends an ambulance after the trip, reports its progress, then puts everything back", async () => {
    const m = makeControls();
    const startAmbulance = vi.fn<() => void>();
    const stopAmbulance = vi.fn<() => void>();
    let polls = 0;
    const runStatus = vi.fn(() => {
      polls += 1;
      return {
        passed: Math.min(3, polls),
        total: 3,
        savedSec: 40 * Math.min(3, polls),
        heldVehicles: 10,
        finished: polls >= 4,
      };
    });
    render(<Harness controls={{ ...m.controls, startAmbulance, runStatus, stopAmbulance }} />);
    fireEvent.click(screen.getByText("start"));
    // Run the tour on until the ambulance caption is up.
    for (let i = 0; i < 400 && !screen.queryByText(/Cleared [0-9] of 3 signals/); i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
    }
    expect(startAmbulance).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Cleared [0-9] of 3 signals/)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(stopAmbulance).toHaveBeenCalled();
    // The tour still ends by handing back to the present.
    expect(m.setTime).toHaveBeenLastCalledWith(null);
  });

  it("cancels the ambulance when the tour is stopped", async () => {
    const m = makeControls();
    const stopAmbulance = vi.fn<() => void>();
    render(<Harness controls={{ ...m.controls, stopAmbulance }} />);
    fireEvent.click(screen.getByText("start"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    fireEvent.click(screen.getByLabelText("Stop the tour"));
    expect(stopAmbulance).toHaveBeenCalledTimes(1);
  });

  it("stops at once when asked and puts everything back", async () => {
    const m = makeControls();
    const controls = m.controls;
    render(<Harness controls={controls} />);
    fireEvent.click(screen.getByText("start"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    const callsBefore = m.setTime.mock.calls.length;
    fireEvent.click(screen.getByLabelText("Stop the tour"));
    expect(screen.getByTestId("state").textContent).toBe("false");
    expect(m.clearTrip).toHaveBeenCalled();
    expect(m.setTime).toHaveBeenLastCalledWith(null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // Nothing more happens after a stop.
    expect(m.setTime.mock.calls.length).toBe(callsBefore + 1);
  });

  it.each([
    [
      { waitFixed: 100, waitAdaptive: 60, percent: 40 },
      /60 s with the adaptive controller against 100 s/,
    ],
    [{ waitFixed: 50, waitAdaptive: 50, percent: 0 }, /about the same/],
    [{ waitFixed: 33, waitAdaptive: 39, percent: -18 }, /does not win at every junction/],
  ])(
    "describes the replay at a stop honestly, whichever way it went (%j)",
    async (result, expected) => {
      const m = makeControls();
      m.replay.mockReturnValue(result);
      render(<Harness controls={m.controls} />);
      fireEvent.click(screen.getByText("start"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_700 + 6_000);
      });
      expect(screen.getByText(expected)).toBeTruthy();
    },
  );

  it("Escape also stops it", async () => {
    const m = makeControls();
    const controls = m.controls;
    render(<Harness controls={controls} />);
    fireEvent.click(screen.getByText("start"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("state").textContent).toBe("false");
  });

  it("a second start replaces the first instead of running two tours", async () => {
    const m = makeControls();
    const controls = m.controls;
    render(<Harness controls={controls} />);
    fireEvent.click(screen.getByText("start"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    fireEvent.click(screen.getByText("start"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    // After the restart the time goes back to the present before sweeping again.
    const calls = m.setTime.mock.calls.map((c) => c[0]);
    expect(calls.filter((c) => c === null).length).toBeGreaterThanOrEqual(2);
  });
});
