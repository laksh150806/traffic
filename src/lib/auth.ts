import { useEffect, useState, useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import { DATA_MODE } from "@/lib/data-mode";

/**
 * Operator sign-in. Roles live in public.operator_profiles and are enforced by Postgres row-level
 * security, so everything here is only for showing the right controls: a viewer who forges a
 * request is still refused by the database.
 */
export type Role = "admin" | "operator" | "viewer";

export type Operator = {
  userId: string;
  email: string | null;
  displayName: string;
  role: Role;
};

export type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; operator: Operator }
  /** Signed in, but the roles migration has not been run on this database yet. */
  | { status: "no-roles"; email: string | null };

export const AUTH_AVAILABLE = DATA_MODE === "live";

const database = async () => (await import("@/integrations/supabase/client")).supabase;

let state: AuthState = AUTH_AVAILABLE ? { status: "loading" } : { status: "signed-out" };
const listeners = new Set<() => void>();
const publish = (next: AuthState) => {
  state = next;
  for (const listener of listeners) listener();
};

async function resolve(session: Session | null) {
  if (!session) return publish({ status: "signed-out" });
  const db = await database();
  const { data, error } = await db
    .from("operator_profiles")
    .select("user_id, display_name, role")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error || !data) return publish({ status: "no-roles", email: session.user.email ?? null });
  publish({
    status: "signed-in",
    operator: {
      userId: data.user_id,
      email: session.user.email ?? null,
      displayName: data.display_name,
      role: (["admin", "operator", "viewer"].includes(data.role) ? data.role : "viewer") as Role,
    },
  });
}

let started = false;
function start() {
  if (started || !AUTH_AVAILABLE || typeof window === "undefined") return;
  started = true;
  void database().then((db) => {
    void db.auth.getSession().then(({ data }) => resolve(data.session));
    db.auth.onAuthStateChange((_event, session) => {
      // Supabase warns against awaiting other calls inside this callback.
      window.setTimeout(() => void resolve(session), 0);
    });
  });
}

const subscribe = (listener: () => void) => {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const SERVER_STATE: AuthState = { status: "loading" };

export function useAuth(): AuthState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE,
  );
}

export function canOperate(auth: AuthState): boolean {
  return (
    auth.status === "signed-in" &&
    (auth.operator.role === "operator" || auth.operator.role === "admin")
  );
}

export function isAdmin(auth: AuthState): boolean {
  return auth.status === "signed-in" && auth.operator.role === "admin";
}

/** Refresh the role after an admin changes it. */
export async function refreshAuth() {
  const db = await database();
  const { data } = await db.auth.getSession();
  await resolve(data.session);
}

export async function signIn(email: string, password: string) {
  const db = await database();
  const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(error.message);
}

export async function signUp(email: string, password: string, displayName: string) {
  const db = await database();
  const { data, error } = await db.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { display_name: displayName.trim() } },
  });
  if (error) throw new Error(error.message);
  // With email confirmation on, there is a user but no session until the link is clicked.
  return { needsConfirmation: !data.session };
}

export async function signOut() {
  const db = await database();
  await db.auth.signOut();
}

/** Re-render on a timer, for countdowns. */
export function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
