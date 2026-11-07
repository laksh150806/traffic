import type { Role } from "@/lib/auth";

/**
 * Reads and writes for the incident board, signal holds, the operator log and the crew list.
 * Every write goes through the signed-in user's own session, so Postgres row-level security
 * decides what is allowed; these functions only turn its refusals into readable messages.
 */
const database = async () => (await import("@/integrations/supabase/client")).supabase;

export const INCIDENT_KINDS = ["ACCIDENT", "LANE_BLOCKED", "ROADWORK", "SIGNAL_FAULT"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export type BoardIncident = {
  incident_id: number;
  junction_id: number;
  road_id: number;
  kind: string;
  note: string | null;
  severity: number;
  starts_at: string;
  ends_at: string;
  junction_name: string | null;
  zone: string | null;
  direction: string | null;
  active: boolean;
  reported_by_name: string | null;
  ended_by_name: string | null;
};

export type LogEntry = {
  action_id: number;
  at: string;
  action: string;
  junction_id: number | null;
  junction_name: string | null;
  actor_name: string | null;
  actor_role: string | null;
  detail: Record<string, unknown>;
};

export type Hold = {
  hold_id: number;
  junction_id: number;
  road_id: number;
  reason: string;
  starts_at: string;
  ends_at: string;
};

export type CrewMember = { user_id: string; display_name: string; role: Role; created_at: string };

/** The roles migration has not been run: the table or view does not exist. */
export class MissingMigrationError extends Error {
  constructor() {
    super(
      "This database has no operator tables yet. Run supabase/migrations/20261107120000_operator_roles_and_rls.sql in the Supabase SQL editor.",
    );
  }
}

type PgError = { code?: string; message: string } | null;

function explain(error: PgError, what: string): never {
  if (!error) throw new Error(`${what} failed`);
  if (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message))
    throw new MissingMigrationError();
  if (error.code === "42501" || /row-level security|permission denied/i.test(error.message))
    throw new Error(`${what}: your role is not allowed to do this.`);
  throw new Error(`${what}: ${error.message}`);
}

export async function fetchIncidentBoard(): Promise<BoardIncident[]> {
  const db = await database();
  const { data, error } = await db
    .from("v_incident_board")
    .select("*")
    .order("starts_at", { ascending: false })
    .limit(80);
  if (error) explain(error, "Incident board");
  return (data ?? []) as BoardIncident[];
}

export async function fetchOperatorLog(limit = 60): Promise<LogEntry[]> {
  const db = await database();
  const { data, error } = await db
    .from("v_operator_log")
    .select("*")
    .order("at", { ascending: false })
    .limit(limit);
  if (error) explain(error, "Operator log");
  return (data ?? []) as LogEntry[];
}

export async function fetchActiveHolds(): Promise<Hold[]> {
  const db = await database();
  const { data, error } = await db
    .from("signal_holds")
    .select("hold_id, junction_id, road_id, reason, starts_at, ends_at")
    .gt("ends_at", new Date().toISOString());
  if (error) explain(error, "Signal holds");
  return (data ?? []) as Hold[];
}

export async function fetchCrew(): Promise<CrewMember[]> {
  const db = await database();
  const { data, error } = await db
    .from("operator_profiles")
    .select("user_id, display_name, role, created_at")
    .order("created_at");
  if (error) explain(error, "Crew");
  return (data ?? []) as CrewMember[];
}

export async function reportIncident(input: {
  junctionId: number;
  roadId: number;
  kind: IncidentKind;
  severity: 1 | 2 | 3;
  minutes: number;
  note: string;
}) {
  const db = await database();
  const now = Date.now();
  const { error } = await db.from("incidents").insert({
    junction_id: input.junctionId,
    road_id: input.roadId,
    kind: input.kind,
    severity: input.severity,
    note: input.note.trim() || null,
    starts_at: new Date(now).toISOString(),
    ends_at: new Date(now + Math.min(24 * 60, Math.max(5, input.minutes)) * 60_000).toISOString(),
  });
  if (error) explain(error, "Report incident");
}

export async function endIncident(incidentId: number, userId: string) {
  const db = await database();
  const { error } = await db
    .from("incidents")
    .update({ ends_at: new Date().toISOString(), ended_by: userId })
    .eq("incident_id", incidentId);
  if (error) explain(error, "End incident");
}

export async function deleteIncident(incidentId: number) {
  const db = await database();
  const { error } = await db.from("incidents").delete().eq("incident_id", incidentId);
  if (error) explain(error, "Delete incident");
}

export async function holdSignal(input: {
  junctionId: number;
  roadId: number;
  minutes: number;
  reason: string;
  userId: string;
}) {
  const db = await database();
  const now = Date.now();
  const { error } = await db.from("signal_holds").insert({
    junction_id: input.junctionId,
    road_id: input.roadId,
    reason: input.reason.trim(),
    held_by: input.userId,
    starts_at: new Date(now).toISOString(),
    ends_at: new Date(now + Math.min(15, Math.max(1, input.minutes)) * 60_000).toISOString(),
  });
  if (error) explain(error, "Hold signal");
}

export async function releaseHold(holdId: number, userId: string) {
  const db = await database();
  const { error } = await db
    .from("signal_holds")
    .update({ ends_at: new Date().toISOString(), released_by: userId })
    .eq("hold_id", holdId);
  if (error) explain(error, "Release hold");
}

export async function setRole(userId: string, role: Role) {
  const db = await database();
  const { error } = await db.rpc("set_operator_role", { p_user: userId, p_role: role });
  if (error) explain(error, "Change role");
}

export async function logDispatch(junctionId: number, hospital: string, stops: number) {
  const db = await database();
  const { error } = await db.rpc("log_dispatch", {
    p_junction: junctionId,
    p_hospital: hospital,
    p_stops: stops,
  });
  if (error) explain(error, "Log dispatch");
}

/** One short line for the log terminal and the ticker. */
export function describeAction(entry: LogEntry): string {
  const where = entry.junction_name ?? (entry.junction_id ? `J${entry.junction_id}` : "network");
  const d = entry.detail ?? {};
  switch (entry.action) {
    case "INCIDENT_REPORTED":
      return `incident ${String(d["kind"] ?? "").toLowerCase().replace("_", " ")} reported at ${where}`;
    case "INCIDENT_ENDED":
      return `incident cleared at ${where}`;
    case "INCIDENT_DELETED":
      return `incident record removed at ${where}`;
    case "SIGNAL_HELD":
      return `signal held green at ${where}: ${String(d["reason"] ?? "")}`;
    case "SIGNAL_RELEASED":
      return `signal hold released at ${where}`;
    case "AMBULANCE_DISPATCHED":
      return `ambulance corridor from ${where} to ${String(d["hospital"] ?? "hospital")}`;
    case "ROLE_CHANGED":
      return `role changed ${String(d["from"] ?? "")} to ${String(d["to"] ?? "")}`;
    default:
      return entry.action.toLowerCase();
  }
}
