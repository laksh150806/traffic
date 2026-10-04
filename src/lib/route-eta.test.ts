import { describe, expect, it } from "vitest";
import { parsePoint, parseTomTomRoute } from "@/lib/route-eta";

describe("points from a URL", () => {
  it("accepts a point inside Chennai", () => {
    expect(parsePoint("13.0067,80.2206")).toEqual({ lat: 13.0067, lng: 80.2206 });
    expect(parsePoint("13,80.2")).toEqual({ lat: 13, lng: 80.2 });
  });

  it("refuses anything else, so the route service cannot be used for other trips", () => {
    expect(parsePoint(null)).toBeNull();
    expect(parsePoint("")).toBeNull();
    expect(parsePoint("13.0")).toBeNull();
    expect(parsePoint("13.0,80.2,5")).toBeNull();
    expect(parsePoint("a,b")).toBeNull();
    expect(parsePoint("28.6,77.2")).toBeNull(); // Delhi
    expect(parsePoint("13.0;rm,80.2")).toBeNull();
    expect(parsePoint("13.0,80.2\nx")).toBeNull();
  });
});

describe("reading a TomTom route", () => {
  const reply = {
    routes: [
      {
        summary: {
          lengthInMeters: 11990,
          travelTimeInSeconds: 1500,
          noTrafficTravelTimeInSeconds: 1412,
          trafficDelayInSeconds: 88,
        },
      },
    ],
  };

  it("reads length, time with traffic, free-flow time and the delay", () => {
    expect(parseTomTomRoute(reply, 9)).toEqual({
      lengthM: 11990,
      travelSec: 1500,
      freeFlowSec: 1412,
      delaySec: 88,
      fetchedAtMs: 9,
    });
  });

  it("works the delay out when the reply leaves it out, and never reports a negative one", () => {
    const noDelay = {
      routes: [
        {
          summary: {
            lengthInMeters: 5,
            travelTimeInSeconds: 100,
            noTrafficTravelTimeInSeconds: 120,
          },
        },
      ],
    };
    expect(parseTomTomRoute(noDelay, 1)?.delaySec).toBe(0);
  });

  it("refuses a reply without a usable route", () => {
    expect(parseTomTomRoute(null, 1)).toBeNull();
    expect(parseTomTomRoute({}, 1)).toBeNull();
    expect(parseTomTomRoute({ routes: [] }, 1)).toBeNull();
    expect(parseTomTomRoute({ routes: [{ summary: { lengthInMeters: 1 } }] }, 1)).toBeNull();
  });
});
