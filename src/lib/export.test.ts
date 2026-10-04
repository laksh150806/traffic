import { describe, expect, it } from "vitest";
import { csvCell, csvFileName, networkCsv } from "@/lib/export";
import { forecastNetwork } from "@/lib/forecast";
import { SEED_JUNCTIONS } from "@/lib/seed-junctions";
import type { JunctionSummary } from "@/lib/traffic-types";

const at = new Date(Date.UTC(2026, 9, 5) + (9 - 5.5) * 3600_000); // Monday 9:00 Chennai

const summaries = (): JunctionSummary[] =>
  SEED_JUNCTIONS.map((j) => ({
    junction_id: j.id,
    name: j.name,
    zone: j.zone,
    latitude: j.lat,
    longitude: j.lng,
    avg_vehicle_count: 0,
    total_vehicle_count: 0,
    congestion_level: "LOW",
    last_reading_at: null,
  }));

describe("csvCell", () => {
  it("leaves plain text and numbers alone", () => {
    expect(csvCell("Tambaram Junction")).toBe("Tambaram Junction");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(-3)).toBe("-3");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("defuses a cell a spreadsheet would run as a formula", () => {
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(csvCell("@import")).toBe("'@import");
    expect(csvCell("-2+3")).toBe("'-2+3");
  });
});

describe("networkCsv", () => {
  const forecast = new Map(forecastNetwork(at).map((f) => [f.junctionId, f]));
  const csv = networkCsv(summaries(), forecast, at);
  const rows = csv.trimEnd().split("\r\n");

  it("has a header and one row per junction, in id order", () => {
    expect(rows).toHaveLength(70);
    expect(rows[0]).toBe(
      "time_ist,junction_id,name,zone,latitude,longitude,level,saturation,avg_queue_vehicles,max_queue_vehicles,arrivals_vph,wait_adaptive_s,wait_fixed_s,cycle_s",
    );
    expect(rows[1]!.split(",")[1]).toBe("1");
    expect(rows[69]!.split(",")[1]).toBe("69");
  });

  it("labels the time in Chennai time and gives every row the same number of fields", () => {
    expect(rows[1]!.startsWith("9:00 am,")).toBe(true);
    for (const row of rows.slice(1)) expect(row.split(",").length).toBe(14);
  });

  it("carries the forecast figures", () => {
    const first = rows[1]!.split(",");
    const f = forecast.get(1)!;
    expect(Number(first[7])).toBeCloseTo(f.saturation, 5);
    expect(Number(first[11])).toBeCloseTo(f.delayAdaptive, 5);
    expect(Number(first[12])).toBeCloseTo(f.delayFixed, 5);
  });

  it("ends with a line break and leaves forecast fields empty when there is none", () => {
    expect(csv.endsWith("\r\n")).toBe(true);
    const bare = networkCsv(summaries().slice(0, 1), new Map(), at).trimEnd().split("\r\n");
    expect(bare[1]!.split(",").slice(7)).toEqual(["", "", "", "", "", "", ""]);
  });
});

describe("csvFileName", () => {
  it("uses the Chennai date and time", () => {
    expect(csvFileName(at)).toBe("traffic-2026-10-05-0900.csv");
    // 20:00 UTC on 4 Oct is 01:30 on 5 Oct in Chennai.
    expect(csvFileName(new Date(Date.UTC(2026, 9, 4, 20, 0)))).toBe("traffic-2026-10-05-0130.csv");
  });
});
