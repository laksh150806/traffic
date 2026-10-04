// A small worker that keeps the live control loop running without a browser open.
//
//   CONTROL_URL=http://localhost:3000 CONTROL_CRON_SECRET=... node scripts/control-loop.mjs
//
// It calls POST /api/control every 2 seconds for the signal controller and every 12 seconds for
// the model tick, the same cadence the browser used. Run it on your own machine for a test run, or on
// any always-on host. Stop it with Ctrl+C. Needs Node 22.

const base = (process.env.CONTROL_URL ?? "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.CONTROL_CRON_SECRET;
if (!secret) {
  console.error("Set CONTROL_CRON_SECRET to the same value the app uses.");
  process.exit(1);
}

const ADVANCE_MS = 2000;
const TICK_MS = 12000;
let stopping = false;
const failures = { advance: 0, tick: 0 };

async function call(loop) {
  try {
    const response = await fetch(`${base}/api/control?loop=${loop}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    if (failures[loop] > 0) console.log(`${loop}: recovered after ${failures[loop]} failure(s)`);
    failures[loop] = 0;
  } catch (error) {
    failures[loop] += 1;
    // Say so on the first failure and then only now and then, so a down server does not flood the log.
    if (failures[loop] === 1 || failures[loop] % 30 === 0) {
      console.error(
        `${loop}: ${error instanceof Error ? error.message : error} (failure ${failures[loop]})`,
      );
    }
  }
}

async function every(loop, ms) {
  while (!stopping) {
    const started = Date.now();
    await call(loop);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, ms - (Date.now() - started))));
  }
}

process.on("SIGINT", () => {
  stopping = true;
  console.log("Stopping.");
  setTimeout(() => process.exit(0), 200);
});

console.log(
  `Driving ${base}: signals every ${ADVANCE_MS / 1000} s, model every ${TICK_MS / 1000} s. Ctrl+C to stop.`,
);
await call("tick");
void every("tick", TICK_MS);
void every("advance", ADVANCE_MS);
