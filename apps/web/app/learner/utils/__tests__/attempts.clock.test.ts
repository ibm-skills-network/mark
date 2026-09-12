/**
 * @jest-environment jsdom
 */

import { deriveServerTimeOffsetMs, getAttemptStartedAtMs } from "../attempts";

const MINUTE = 60 * 1000;
const SERVER_NOW = "2026-09-12T12:00:00.000Z";
const SERVER_NOW_MS = Date.parse(SERVER_NOW);

describe("deriveServerTimeOffsetMs", () => {
  it("is zero when the two clocks agree", () => {
    expect(deriveServerTimeOffsetMs(SERVER_NOW, SERVER_NOW_MS)).toBe(0);
  });

  it("is negative by exactly the skew when the device clock runs ahead", () => {
    const deviceNow = SERVER_NOW_MS + 10 * MINUTE;

    expect(deriveServerTimeOffsetMs(SERVER_NOW, deviceNow)).toBe(-10 * MINUTE);
    // Applying it recovers the server's clock from the device's.
    expect(deviceNow + deriveServerTimeOffsetMs(SERVER_NOW, deviceNow)).toBe(
      SERVER_NOW_MS,
    );
  });

  it("is positive when the device clock lags", () => {
    const deviceNow = SERVER_NOW_MS - 4 * MINUTE;

    expect(deriveServerTimeOffsetMs(SERVER_NOW, deviceNow)).toBe(4 * MINUTE);
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(
      deriveServerTimeOffsetMs(new Date(SERVER_NOW), SERVER_NOW_MS + 1000),
    ).toBe(-1000);
  });

  it("falls back to no correction when the payload carries no server clock", () => {
    expect(deriveServerTimeOffsetMs(undefined, SERVER_NOW_MS)).toBe(0);
    expect(deriveServerTimeOffsetMs(null, SERVER_NOW_MS)).toBe(0);
    expect(deriveServerTimeOffsetMs("", SERVER_NOW_MS)).toBe(0);
    expect(deriveServerTimeOffsetMs("not a date", SERVER_NOW_MS)).toBe(0);
  });

  it("defaults to the caller's own clock", () => {
    const offset = deriveServerTimeOffsetMs(new Date().toISOString());

    expect(Math.abs(offset)).toBeLessThan(1000);
  });
});

describe("getAttemptStartedAtMs", () => {
  it("reads the server's creation time", () => {
    expect(getAttemptStartedAtMs(SERVER_NOW)).toBe(SERVER_NOW_MS);
    expect(getAttemptStartedAtMs(new Date(SERVER_NOW))).toBe(SERVER_NOW_MS);
  });

  it("is undefined when there is no usable creation time", () => {
    expect(getAttemptStartedAtMs(undefined)).toBeUndefined();
    expect(getAttemptStartedAtMs(null)).toBeUndefined();
    expect(getAttemptStartedAtMs("nonsense")).toBeUndefined();
  });
});
