import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DATABASE_JUNCTIONS, SEED_JUNCTIONS } from "@/lib/seed-junctions";
import { SNAP_MAX_M } from "@/lib/osm-snap";

const dir = join(process.cwd(), "supabase", "migrations");
const migrations = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(dir, f), "utf8"));

/** Junctions in the order the migrations insert them (which is the order their ids are issued). */
function junctionsFromMigrations() {
  const rows: Array<{ name: string; lat: number; lng: number; zone: string | null }> = [];
  for (const sql of migrations) {
    for (const block of sql.matchAll(
      /INSERT INTO public\.junctions \(([^)]*)\) VALUES([\s\S]*?);/g,
    )) {
      const withZone = (block[1] ?? "").includes("zone");
      for (const row of (block[2] ?? "").matchAll(
        /\(\s*'((?:[^']|'')*)'\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*(?:,\s*'([^']*)')?\s*\)/g,
      )) {
        rows.push({
          name: (row[1] ?? "").replaceAll("''", "'"),
          lat: Number(row[2]),
          lng: Number(row[3]),
          zone: withZone ? (row[4] ?? null) : null,
        });
      }
    }
  }
  return rows;
}

describe("seed junctions against the SQL migrations", () => {
  const sql = junctionsFromMigrations();

  it("lists the same 69 junctions in the same order", () => {
    expect(sql).toHaveLength(SEED_JUNCTIONS.length);
    sql.forEach((row, index) => {
      const seed = DATABASE_JUNCTIONS[index]!;
      expect(seed.id).toBe(index + 1);
      expect(seed.name).toBe(row.name);
      expect(seed.lat).toBeCloseTo(row.lat, 6);
      expect(seed.lng).toBeCloseTo(row.lng, 6);
    });
  });

  it("only moves a junction from its database position onto a mapped signal close by", () => {
    SEED_JUNCTIONS.forEach((junction, index) => {
      const original = DATABASE_JUNCTIONS[index]!;
      expect(junction.id).toBe(original.id);
      expect(junction.name).toBe(original.name);
      if (!junction.verified) {
        expect(junction.lat).toBe(original.lat);
        expect(junction.lng).toBe(original.lng);
      } else {
        expect(junction.offsetM).toBeLessThanOrEqual(SNAP_MAX_M);
      }
    });
  });

  it("agrees on the zone of every junction", () => {
    const all = migrations.join("\n");
    // The first five are created without a zone, then moved to the GST Corridor.
    expect(all).toMatch(/SET zone = 'GST Corridor' WHERE junction_id BETWEEN 1 AND 5/);
    sql.forEach((row, index) => {
      const expected = index < 5 ? "GST Corridor" : row.zone;
      expect(SEED_JUNCTIONS[index]!.zone).toBe(expected);
    });
  });

  it("gives each road the capacity the migration's rule gives its zone", () => {
    const capacityFor = (index: number, zone: string) => {
      if (index < 5) return 120; // created before the zone rule, with a flat 120
      if (zone === "Central" || zone === "North") return 140;
      if (zone === "Outer") return 100;
      return 120;
    };
    SEED_JUNCTIONS.forEach((seed, index) => {
      expect(seed.capacity).toBe(capacityFor(index, seed.zone));
    });
  });

  it("keeps the junction coordinates inside Chennai's region", () => {
    for (const seed of SEED_JUNCTIONS) {
      expect(seed.lat).toBeGreaterThan(12.5);
      expect(seed.lat).toBeLessThan(13.4);
      expect(seed.lng).toBeGreaterThan(79.8);
      expect(seed.lng).toBeLessThan(80.4);
    }
  });
});

describe("integrity migration", () => {
  const latest = migrations[migrations.length - 1] ?? "";

  it("enforces one green per junction in the database", () => {
    expect(latest).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS signal_timings_one_green_per_junction/,
    );
    expect(latest).toMatch(/WHERE is_currently_green/);
  });

  it("keeps every child row's junction consistent with its road's", () => {
    for (const table of [
      "signal_timings",
      "signal_history",
      "model_road_state",
      "model_accuracy",
    ]) {
      expect(latest).toContain(`'public.${table}'`);
    }
    expect(latest).toMatch(/UNIQUE \(road_id, junction_id\)/);
  });

  it("only lets the server run the control functions", () => {
    for (const fn of [
      "try_acquire_control(text, integer)",
      "apply_green_allocations(jsonb)",
      "apply_phase_changes(jsonb)",
      "prune_old_rows()",
    ]) {
      expect(latest).toContain(
        `REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated`,
      );
      expect(latest).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role`);
    }
  });
});
