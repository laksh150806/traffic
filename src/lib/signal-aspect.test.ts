import { describe, expect, it } from "vitest";
import { isClearing, junctionAspects, type PhaseRow } from "@/lib/signal-aspect";

const T = 1_000_000;
// Road 1 held the green until T, when road 2 was given it.
const rows = (): PhaseRow[] => [
  { id: 1, isGreen: false, startedAtMs: T },
  { id: 2, isGreen: true, startedAtMs: T },
  { id: 3, isGreen: false, startedAtMs: T - 60_000 },
  { id: 4, isGreen: false, startedAtMs: T - 20_000 },
];

describe("signal aspects", () => {
  it("shows amber on the approach that just lost the green, red on the rest", () => {
    const a = junctionAspects(rows(), T + 500);
    expect(a.get(1)).toBe("AMBER");
    expect(a.get(2)).toBe("RED"); // not green yet: start-up and clearance
    expect(a.get(3)).toBe("RED");
    expect(a.get(4)).toBe("RED");
  });

  it("goes all red for the last second of the clearance", () => {
    const a = junctionAspects(rows(), T + 3500);
    expect([...a.values()].every((v) => v === "RED")).toBe(true);
    expect(isClearing(rows(), T + 3500)).toBe(true);
  });

  it("turns green exactly when the model's lost time ends", () => {
    expect(junctionAspects(rows(), T + 3999).get(2)).toBe("RED");
    expect(junctionAspects(rows(), T + 4000).get(2)).toBe("GREEN");
    expect(isClearing(rows(), T + 4000)).toBe(false);
  });

  it("shows plain green and red in the middle of a phase", () => {
    const a = junctionAspects(rows(), T + 30_000);
    expect(a.get(2)).toBe("GREEN");
    expect(a.get(1)).toBe("RED");
  });

  it("copes with no green and with a clock that stepped back", () => {
    const none = junctionAspects(
      rows().map((r) => ({ ...r, isGreen: false })),
      T + 1000,
    );
    expect([...none.values()].every((v) => v === "RED")).toBe(true);
    expect(
      isClearing(
        rows().map((r) => ({ ...r, isGreen: false })),
        T,
      ),
    ).toBe(false);
    expect(junctionAspects(rows(), T - 5000).get(2)).toBe("GREEN");
  });
});
