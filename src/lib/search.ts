import type { JunctionSummary } from "@/lib/traffic-types";

/** Match on the start of the name first, then the start of any word, then anywhere in the name or zone. */
export function searchJunctions(junctions: JunctionSummary[], query: string, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<{ j: JunctionSummary; score: number }> = [];
  for (const j of junctions) {
    const name = j.name.toLowerCase();
    const zone = j.zone.toLowerCase();
    let score = 0;
    if (name.startsWith(q)) score = 4;
    else if (name.split(/\s+/).some((word) => word.startsWith(q))) score = 3;
    else if (name.includes(q)) score = 2;
    else if (zone.includes(q)) score = 1;
    if (score > 0) scored.push({ j, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.j.name.localeCompare(b.j.name))
    .slice(0, limit)
    .map((s) => s.j);
}
