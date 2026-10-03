// Runs the coursework SQL (supabase/rubric/*.sql) against every migration on an in-process Postgres
// and saves what each query returns to supabase/rubric/output/, ready to paste into the report.
//
//   npm run rubric
//
// Every query must run, and every SELECT in 01-04 must return at least one row (a query that comes
// back empty is almost certainly a mistake), otherwise the script exits with an error.

import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrations = path.join(here, "..", "migrations");
const outDir = path.join(here, "output");
fs.mkdirSync(outDir, { recursive: true });

const db = new PGlite();
await db.exec(
  `CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;`,
);
for (const f of fs
  .readdirSync(migrations)
  .filter((n) => n.endsWith(".sql"))
  .sort()) {
  await db.exec(fs.readFileSync(path.join(migrations, f), "utf8"));
}

/** Split a SQL script into statements, respecting quotes, comments and $$ bodies. */
function split(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  let dollar = null;
  let single = false;
  while (i < sql.length) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);
    if (dollar) {
      if (sql.startsWith(dollar, i)) {
        buf += dollar;
        i += dollar.length;
        dollar = null;
      } else buf += sql[i++];
      continue;
    }
    if (single) {
      buf += ch;
      i++;
      if (ch === "'") {
        if (sql[i] === "'") buf += sql[i++];
        else single = false;
      }
      continue;
    }
    if (two === "--") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'") {
      single = true;
      buf += ch;
      i++;
      continue;
    }
    if (ch === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        dollar = m[0];
        buf += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (ch === ";") {
      out.push(buf.trim());
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((s) => s.replace(/--[^\n]*/g, "").trim() !== "");
}

const fmt = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (v instanceof Date)
    return v
      .toISOString()
      .replace("T", " ")
      .replace(/\.000Z$/, "Z");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

function table(fields, rows) {
  const names = fields.map((f) => f.name);
  const cells = rows.map((r) => r.map(fmt));
  const width = names.map((n, c) => Math.max(n.length, ...cells.map((r) => r[c].length)));
  const line = (r) =>
    r
      .map((v, c) => v.padEnd(width[c]))
      .join(" | ")
      .trimEnd();
  return [
    line(names),
    width.map((w) => "-".repeat(w)).join("-+-"),
    ...cells.map(line),
    `(${rows.length} row${rows.length === 1 ? "" : "s"})`,
  ].join("\n");
}

const isQuery = (body) => /^(select|with|table|values|fetch)\b/i.test(body);
const stripComments = (s) => s.replace(/^(\s*--[^\n]*\n)+/, "").trim();

let problems = 0;
const summary = [];
const files = fs
  .readdirSync(here)
  .filter((n) => /^\d\d_.*\.sql$/.test(n))
  .sort();
for (const file of files) {
  const text = fs.readFileSync(path.join(here, file), "utf8");
  const statements = split(text);
  const report = [`== ${file} ==`, ""];
  let queries = 0;
  let setup = 0;
  for (const raw of statements) {
    const body = stripComments(raw);
    const comment = raw.slice(0, raw.length - body.length).trim();
    try {
      if (/^(begin|commit)$/i.test(body)) {
        await db.exec(body);
        continue;
      }
      if (isQuery(body)) {
        const res = await db.query(body, [], { rowMode: "array" });
        queries++;
        if (res.rows.length === 0 && !file.startsWith("00") && !file.startsWith("99")) {
          problems++;
          report.push(comment, "", "!! EMPTY RESULT", "");
          console.error(`EMPTY  ${file}: ${comment.split("\n")[0]}`);
        } else {
          report.push(comment, "", body, "", table(res.fields, res.rows), "", "");
        }
      } else if (/^call\b/i.test(body)) {
        const res = await db.query(body, [], { rowMode: "array" });
        queries++;
        report.push(comment, "", body, "", table(res.fields, res.rows), "", "");
      } else {
        await db.exec(body);
        setup++;
        const head = body.split("\n")[0].slice(0, 90);
        const show =
          /^(update|insert|delete)\b/i.test(body) ||
          /^create (or replace )?(view|trigger)/i.test(body);
        if (show && comment) report.push(comment, "", body, "", "OK", "", "");
        else if (/^create (or replace )?(view|table|function|procedure|trigger)/i.test(body))
          report.push(`-- ${head}`, "");
      }
    } catch (e) {
      problems++;
      report.push(comment, "", body, "", `!! ERROR: ${e.message}`, "");
      console.error(
        `ERROR  ${file}: ${comment.split("\n")[0] || body.split("\n")[0]}\n       ${e.message}`,
      );
    }
  }
  fs.writeFileSync(
    path.join(outDir, file.replace(/\.sql$/, ".txt")),
    report.join("\n").replace(/\n{3,}/g, "\n\n") + "\n",
  );
  summary.push(
    `${file.padEnd(28)} ${String(queries).padStart(2)} queries, ${setup} setup statements`,
  );
}

console.log(summary.join("\n"));
console.log(
  problems === 0
    ? "\nAll coursework SQL ran and every query returned rows."
    : `\n${problems} problem(s).`,
);
process.exit(problems === 0 ? 0 : 1);
