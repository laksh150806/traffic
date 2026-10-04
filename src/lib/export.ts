/**
 * A spreadsheet-ready snapshot of the whole network at one moment, for pasting into a report.
 */
import { formatIstTime, type JunctionForecast } from "@/lib/forecast";
import type { JunctionSummary } from "@/lib/traffic-types";

/** RFC 4180 quoting, and a leading apostrophe-free guard against spreadsheet formulas. */
export function csvCell(value: string | number) {
  let text = String(value);
  // A cell that starts with these is read as a formula by Excel and Sheets.
  if (/^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text))) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const COLUMNS = [
  "time_ist",
  "junction_id",
  "name",
  "zone",
  "latitude",
  "longitude",
  "level",
  "saturation",
  "avg_queue_vehicles",
  "max_queue_vehicles",
  "arrivals_vph",
  "wait_adaptive_s",
  "wait_fixed_s",
  "cycle_s",
] as const;

export function networkCsv(
  junctions: JunctionSummary[],
  forecast: ReadonlyMap<number, JunctionForecast>,
  at: Date,
) {
  const when = formatIstTime(at);
  const lines = [COLUMNS.join(",")];
  for (const j of [...junctions].sort((a, b) => a.junction_id - b.junction_id)) {
    const f = forecast.get(j.junction_id);
    lines.push(
      [
        when,
        j.junction_id,
        j.name,
        j.zone,
        j.latitude,
        j.longitude,
        j.congestion_level,
        f?.saturation ?? "",
        f?.queue ?? "",
        f?.maxQueue ?? "",
        f ? Math.round(f.flowVph) : "",
        f?.delayAdaptive ?? "",
        f?.delayFixed ?? "",
        f?.cycle ?? "",
      ]
        .map((cell) => csvCell(cell))
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** A file name that sorts by time, e.g. traffic-2026-10-05-0900.csv (Chennai time). */
export function csvFileName(at: Date) {
  const ist = new Date(at.getTime() + 5.5 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `traffic-${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}-${pad(
    ist.getUTCHours(),
  )}${pad(ist.getUTCMinutes())}.csv`;
}
