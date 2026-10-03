/**
 * Where the dashboard gets its data.
 *
 * - "demo": the in-browser engine (src/lib/demo-engine.ts). No backend needed.
 * - "live": Supabase reads plus the server functions that run the control loop.
 *
 * Set VITE_DATA_MODE=live in .env.local once a Supabase project is connected.
 */
export type DataMode = "demo" | "live";

export const DATA_MODE: DataMode = import.meta.env["VITE_DATA_MODE"] === "live" ? "live" : "demo";
