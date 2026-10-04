import { describe, expect, it } from "vitest";
import { decodeView, encodeView, type ShareView } from "@/lib/share";

const NOW = Date.UTC(2026, 9, 5, 4, 0); // a fixed "now"
const HOUR = 3600_000;

describe("share links", () => {
  it("round-trips a full view", () => {
    const view: ShareView = {
      junction: 24,
      atMs: NOW + 5 * HOUR,
      from: { lat: 13.0827, lng: 80.2707, label: "Chennai Central Junction" },
      to: { lat: 12.9249, lng: 80.1, label: "Tambaram Junction" },
      tab: "directions",
    };
    expect(decodeView(encodeView(view, NOW), NOW)).toEqual(view);
  });

  it("keeps commas, ampersands and non-latin text in a label intact", () => {
    const view: ShareView = {
      from: { lat: 13.05, lng: 80.2, label: "A, B & C 100% சென்னை" },
    };
    expect(decodeView(encodeView(view, NOW), NOW).from?.label).toBe("A, B & C 100% சென்னை");
  });

  it("leaves out a moment that has already passed", () => {
    expect(encodeView({ junction: 3, atMs: NOW - HOUR }, NOW)).toBe("j=3");
    expect(decodeView("t=" + Math.round((NOW - HOUR) / 60_000), NOW).atMs).toBeUndefined();
  });

  it("is empty for an empty view", () => {
    expect(encodeView({}, NOW)).toBe("");
    expect(decodeView("", NOW)).toEqual({});
    expect(decodeView("?", NOW)).toEqual({});
  });

  it("accepts a leading question mark", () => {
    expect(decodeView("?j=7", NOW).junction).toBe(7);
  });

  it("drops anything that is not a sensible value instead of failing", () => {
    expect(decodeView("j=abc", NOW).junction).toBeUndefined();
    expect(decodeView("j=-4", NOW).junction).toBeUndefined();
    expect(decodeView("j=2.5", NOW).junction).toBeUndefined();
    expect(decodeView("j=99999999", NOW).junction).toBeUndefined();
    expect(decodeView("t=nope", NOW).atMs).toBeUndefined();
    expect(decodeView(`t=${Math.round((NOW + 40 * HOUR) / 60_000)}`, NOW).atMs).toBeUndefined();
    expect(decodeView("tab=admin", NOW).tab).toBeUndefined();
  });

  it("drops points outside Chennai or malformed", () => {
    expect(decodeView("from=40.7,-74.0&fromName=New%20York", NOW).from).toBeUndefined();
    expect(decodeView("from=13.0,notanumber", NOW).from).toBeUndefined();
    expect(decodeView("from=13.0", NOW).from).toBeUndefined();
    expect(decodeView("from=13.0,80.2,5", NOW).from).toBeUndefined();
    expect(decodeView("from=NaN,NaN", NOW).from).toBeUndefined();
  });

  it("gives a point a default label and trims a long or control-character one", () => {
    expect(decodeView("from=13.0,80.2", NOW).from?.label).toBe("Shared place");
    const long = decodeView(`from=13.0,80.2&fromName=${"x".repeat(500)}`, NOW).from!;
    expect(long.label.length).toBeLessThanOrEqual(60);
    expect(decodeView("from=13.0,80.2&fromName=a%00b%1Fc", NOW).from?.label).toBe("abc");
  });

  it("does not let a label carry markup into a link that reads it back as plain text", () => {
    const label = decodeView("from=13,80.2&fromName=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E", NOW)
      .from!.label;
    // It is only ever rendered as text, so the check is that it round-trips as the same string.
    expect(label).toBe("<img src=x onerror=alert(1)>");
  });
});
