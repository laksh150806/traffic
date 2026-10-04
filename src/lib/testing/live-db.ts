/** A fresh in-process Postgres with every migration applied, and a Supabase-style client over it. */
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { createPgliteSupabase } from "@/lib/testing/pglite-supabase";

export async function createLiveDb() {
  const db = new PGlite();
  await db.exec(
    `CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;`,
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
