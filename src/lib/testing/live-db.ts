/** A fresh in-process Postgres with every migration applied, and a Supabase-style client over it. */
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { createPgliteSupabase } from "@/lib/testing/pglite-supabase";

export async function createLiveDb() {
  const db = new PGlite();
  await db.exec(
    `CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
     CREATE SCHEMA auth;
     CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
     CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
     GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
     GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;`,
  );
  const dir = path.join(process.cwd(), "supabase", "migrations");
  for (const f of fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    await db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  }
  return { db, client: createPgliteSupabase(db) };
}
