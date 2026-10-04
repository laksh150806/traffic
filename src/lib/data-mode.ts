/**
 * Where the dashboard gets its data.
 *
 * - "simulated": the in-browser engine (src/lib/sim-engine.ts). No backend needed.
 * - "live": Supabase reads plus the server functions that run the control loop.
 *
 * Set VITE_DATA_MODE=live in .env.local once a Supabase project is connected.
 */
export type DataMode = "simulated" | "live";

export const DATA_MODE: DataMode =
  import.meta.env["VITE_DATA_MODE"] === "live" ? "live" : "simulated";

/**
 * In live mode an open page normally drives the control loops. Set VITE_BROWSER_DRIVES_LOOP=false
 * when a scheduler does it (see README) and pages only read.
 */
export const BROWSER_DRIVES_LOOP = import.meta.env["VITE_BROWSER_DRIVES_LOOP"] !== "false";
