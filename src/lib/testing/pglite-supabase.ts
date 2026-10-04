/**
 * A stand-in for the slice of supabase-js the server functions use, backed by an in-process
 * Postgres (PGlite), so the live control loop can run against the real migrations in a test.
 *
 * It is not PostgREST: it covers from().select()/insert()/upsert() with eq, in, gt, gte, lt, lte,
 * order and limit, plus rpc() with named arguments. Rows come back as JSON, the way PostgREST
 * returns them (numbers as numbers, timestamps as ISO strings). Test support only; nothing in the
 * app imports it.
 */
import type { PGlite } from "@electric-sql/pglite";

type Result<T = unknown> = { data: T; error: { message: string } | null };
type Filter = { column: string; op: string; value: unknown };

const OPS: Record<string, string> = { eq: "=", gt: ">", gte: ">=", lt: "<", lte: "<=" };

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
};

/** Plain values only: objects go over the wire as JSON text, which Postgres reads into json/jsonb. */
const param = (value: unknown) =>
  value !== null && typeof value === "object" ? JSON.stringify(value) : value;

class Builder implements PromiseLike<Result> {
  private mode: "select" | "insert" | "upsert" = "select";
  private columns = "*";
  private filters: Filter[] = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private limitCount: number | null = null;
  private rows: Array<Record<string, unknown>> = [];
  private conflict: string | null = null;
  private single = false;

  constructor(
    private readonly db: PGlite,
    private readonly table: string,
  ) {}

  select(columns = "*") {
    this.columns = columns;
    return this;
  }
  insert(rows: Array<Record<string, unknown>> | Record<string, unknown>) {
    this.mode = "insert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(
    rows: Array<Record<string, unknown>> | Record<string, unknown>,
    options: { onConflict?: string } = {},
  ) {
    this.mode = "upsert";
    this.rows = Array.isArray(rows) ? rows : [rows];
    this.conflict = options.onConflict ?? null;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push({ column, op: "eq", value });
    return this;
  }
  gt(column: string, value: unknown) {
    this.filters.push({ column, op: "gt", value });
    return this;
  }
  gte(column: string, value: unknown) {
    this.filters.push({ column, op: "gte", value });
    return this;
  }
  lt(column: string, value: unknown) {
    this.filters.push({ column, op: "lt", value });
    return this;
  }
  lte(column: string, value: unknown) {
    this.filters.push({ column, op: "lte", value });
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push({ column, op: "in", value: values });
    return this;
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.orders.push({ column, ascending: options.ascending ?? true });
    return this;
  }
  /** First row or null, as supabase-js maybeSingle() gives. */
  maybeSingle() {
    this.single = true;
    this.limitCount = 1;
    return this;
  }
  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  private async run(): Promise<Result> {
    const table = `public.${ident(this.table)}`;
    try {
      if (this.mode === "select") {
        const params: unknown[] = [];
        const where = this.filters.map((f) => {
          // Arrays are for IN lists and go over as real arrays; objects become JSON text.
          params.push(Array.isArray(f.value) ? f.value : param(f.value));
          const col = ident(f.column);
          return f.op === "in"
            ? `${col} = ANY($${params.length})`
            : `${col} ${OPS[f.op]} $${params.length}`;
        });
        const order = this.orders.map((o) => `${ident(o.column)} ${o.ascending ? "ASC" : "DESC"}`);
        const columns =
          this.columns.trim() === "*"
            ? "*"
            : this.columns
                .split(",")
                .map((c) => ident(c.trim()))
                .join(", ");
        const sql =
          `SELECT coalesce(json_agg(t), '[]'::json) AS data FROM (` +
          `SELECT ${columns} FROM ${table}` +
          (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
          (order.length ? ` ORDER BY ${order.join(", ")}` : "") +
          (this.limitCount === null ? "" : ` LIMIT ${Number(this.limitCount)}`) +
          `) t`;
        const res = await this.db.query<{ data: unknown }>(sql, params);
        const rows = (res.rows[0]?.data ?? []) as unknown[];
        return { data: this.single ? (rows[0] ?? null) : rows, error: null };
      }

      if (this.rows.length === 0) return { data: null, error: null };
      const columns = [...new Set(this.rows.flatMap((r) => Object.keys(r)))];
      const list = columns.map(ident).join(", ");
      let sql =
        `INSERT INTO ${table} (${list}) ` +
        `SELECT ${list} FROM json_populate_recordset(null::${table}, $1::json)`;
      if (this.mode === "upsert") {
        const keys = (this.conflict ?? "").split(",").map((c) => c.trim());
        const updates = columns.filter((c) => !keys.includes(c));
        sql +=
          ` ON CONFLICT (${keys.map(ident).join(", ")}) DO ` +
          (updates.length
            ? `UPDATE SET ${updates.map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`).join(", ")}`
            : "NOTHING");
      }
      await this.db.query(sql, [JSON.stringify(this.rows)]);
      return { data: null, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(onfulfilled, onrejected);
  }
}

export function createPgliteSupabase(db: PGlite) {
  return {
    from: (table: string) => new Builder(db, table),
    async rpc(name: string, args: Record<string, unknown> = {}): Promise<Result> {
      try {
        const keys = Object.keys(args);
        const call = keys.map((k, i) => `${ident(k)} := $${i + 1}`).join(", ");
        const res = await db.query<Record<string, unknown>>(
          `SELECT public.${ident(name)}(${call}) AS result`,
          keys.map((k) => param(args[k])),
        );
        const value = res.rows[0]?.["result"];
        // void functions come back as an empty string, large integers as bigint.
        return {
          data: typeof value === "bigint" ? Number(value) : value === "" ? null : (value ?? null),
          error: null,
        };
      } catch (error) {
        return {
          data: null,
          error: { message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
  };
}
