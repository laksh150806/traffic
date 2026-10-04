import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/control?loop=advance|tick|both
 *
 * Runs one step of the live control loop. A scheduler (scripts/control-loop.mjs, or pg_cron through
 * supabase/scheduling.sql) calls it with `Authorization: Bearer $CONTROL_CRON_SECRET`. The database
 * still throttles the work, so calling it too often is harmless. Set CONTROL_BROWSER_DRIVEN=false
 * once a scheduler is running to switch the open-to-anyone browser endpoints off.
 */
export const Route = createFileRoute("/api/control")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authenticateControlRequest } = await import("@/lib/control-auth");
        const denied = authenticateControlRequest(
          request.headers.get("authorization"),
          process.env["CONTROL_CRON_SECRET"],
        );
        if (denied) return denied;

        const loop = new URL(request.url).searchParams.get("loop") ?? "both";
        if (!["advance", "tick", "both"].includes(loop)) {
          return new Response("loop must be advance, tick or both", { status: 400 });
        }
        try {
          const { performAdvance, performTick } = await import("@/lib/traffic.functions");
          const body: Record<string, unknown> = {};
          if (loop === "tick" || loop === "both") body["tick"] = await performTick();
          if (loop === "advance" || loop === "both") body["advance"] = await performAdvance();
          return Response.json(body);
        } catch (error) {
          console.error("Control loop failed", error);
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
