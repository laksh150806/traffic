import { describe, expect, it } from "vitest";
import { authenticateControlRequest } from "@/lib/control-auth";

const SECRET = "correct-horse-battery-staple";

describe("authenticateControlRequest", () => {
  it("lets a request with the right secret through", () => {
    expect(authenticateControlRequest(`Bearer ${SECRET}`, SECRET)).toBeNull();
  });

  it("refuses a wrong, missing or malformed secret with 401", async () => {
    for (const header of [
      "Bearer wrong-secret-entirely",
      `Bearer ${SECRET}x`,
      `Bearer ${SECRET.slice(0, -1)}`,
      SECRET,
      `Basic ${SECRET}`,
      "Bearer ",
      "",
      null,
    ]) {
      const denied = authenticateControlRequest(header, SECRET);
      expect(denied?.status).toBe(401);
    }
  });

  it("refuses everything when no secret is configured, instead of being open", () => {
    expect(authenticateControlRequest("Bearer anything-goes-here", undefined)?.status).toBe(500);
    expect(authenticateControlRequest("Bearer ", "")?.status).toBe(500);
  });

  it("refuses a configured secret that is too short to be safe", () => {
    expect(authenticateControlRequest("Bearer short", "short")?.status).toBe(500);
  });

  it("does not echo the secret back", async () => {
    const denied = authenticateControlRequest("Bearer nope-nope-nope-nope", SECRET);
    expect(await denied!.text()).not.toContain(SECRET);
  });
});
