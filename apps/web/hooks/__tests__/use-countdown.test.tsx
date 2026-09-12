/**
 * @jest-environment jsdom
 */

import { act, renderHook } from "@testing-library/react";
import useCountdown from "../use-countdown";

const MINUTE = 60 * 1000;

// A fixed "real" instant so the arithmetic below reads plainly.
const SERVER_NOW = Date.parse("2026-09-12T12:00:00.000Z");

describe("useCountdown", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("counts down against the device clock when no server offset is known", () => {
    jest.setSystemTime(SERVER_NOW);
    const expiresAt = SERVER_NOW + 20 * MINUTE;

    const { result } = renderHook(() => useCountdown(expiresAt));

    expect(result.current.countdown).toBe(20 * MINUTE);
    expect(result.current.timerExpired).toBe(false);

    act(() => {
      jest.advanceTimersByTime(5 * MINUTE);
    });

    expect(result.current.countdown).toBe(15 * MINUTE);
  });

  it("reports the server's remaining time, not the device's, when the device clock runs ahead", () => {
    // The learner's device thinks it is 10 minutes later than it really is.
    const deviceSkew = 10 * MINUTE;
    jest.setSystemTime(SERVER_NOW + deviceSkew);
    const expiresAt = SERVER_NOW + 20 * MINUTE;
    const serverOffset = -deviceSkew; // serverNow - deviceNow, taken at fetch

    const { result } = renderHook(() => useCountdown(expiresAt, serverOffset));

    expect(result.current.countdown).toBe(20 * MINUTE);
    expect(result.current.timerExpired).toBe(false);

    act(() => {
      jest.advanceTimersByTime(MINUTE);
    });

    expect(result.current.countdown).toBe(19 * MINUTE);
    expect(result.current.timerExpired).toBe(false);
  });

  it("does not expire an attempt whose device clock is already past expiresAt but whose server clock is not", () => {
    // Device is 25 minutes fast on a 20-minute attempt: unguarded, this is the
    // instant "1 minute remaining" toast followed by a blank auto-submit.
    const deviceSkew = 25 * MINUTE;
    jest.setSystemTime(SERVER_NOW + deviceSkew);
    const expiresAt = SERVER_NOW + 20 * MINUTE;

    const { result } = renderHook(() => useCountdown(expiresAt, -deviceSkew));

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(result.current.timerExpired).toBe(false);
    expect(result.current.countdown).toBeGreaterThan(19 * MINUTE);
  });

  it("still expires once the server-derived remaining time runs out", () => {
    const deviceSkew = 10 * MINUTE;
    jest.setSystemTime(SERVER_NOW + deviceSkew);
    const expiresAt = SERVER_NOW + 2000;

    const { result } = renderHook(() => useCountdown(expiresAt, -deviceSkew));

    expect(result.current.timerExpired).toBe(false);

    act(() => {
      jest.advanceTimersByTime(3000);
    });

    expect(result.current.timerExpired).toBe(true);
  });

  it("never reports a negative countdown", () => {
    jest.setSystemTime(SERVER_NOW);
    const expiresAt = SERVER_NOW - 5 * MINUTE;

    const { result } = renderHook(() => useCountdown(expiresAt));

    expect(result.current.countdown).toBe(0);
  });

  it("ignores an unusable offset instead of corrupting the countdown", () => {
    jest.setSystemTime(SERVER_NOW);
    const expiresAt = SERVER_NOW + 10 * MINUTE;

    const { result } = renderHook(() => useCountdown(expiresAt, Number.NaN));

    expect(result.current.countdown).toBe(10 * MINUTE);
  });

  it("applies the offset when the countdown is reset for a new attempt", () => {
    const deviceSkew = 30 * MINUTE;
    jest.setSystemTime(SERVER_NOW + deviceSkew);

    const { result } = renderHook(() => useCountdown(undefined, -deviceSkew));

    act(() => {
      result.current.resetCountdown(SERVER_NOW + 20 * MINUTE);
    });

    expect(result.current.countdown).toBe(20 * MINUTE);
    expect(result.current.timerExpired).toBe(false);
  });
});
