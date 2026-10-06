/**
 * @jest-environment node
 */

import { APIError, NetworkError } from "../api-client";
import {
  isAuthApiError,
  isTransientApiError,
  withTransientRetry,
} from "../api-retry";

describe("isTransientApiError", () => {
  it.each([408, 502, 503, 504])("treats APIError %s as transient", (status) => {
    expect(isTransientApiError(new APIError("x", status, "x"))).toBe(true);
  });

  it.each([400, 401, 403, 404, 422, 500])(
    "treats APIError %s as definitive",
    (status) => {
      expect(isTransientApiError(new APIError("x", status, "x"))).toBe(false);
    },
  );

  it("treats fetch network failures (TypeError) as transient", () => {
    expect(isTransientApiError(new TypeError("fetch failed"))).toBe(true);
  });

  it("treats a response that arrived incomplete as transient", () => {
    expect(
      isTransientApiError(new NetworkError("cut off", "interrupted")),
    ).toBe(true);
  });

  it("does not retry a request that already used its whole timeout", () => {
    expect(isTransientApiError(new NetworkError("slow", "timeout"))).toBe(
      false,
    );
  });

  it("treats other errors as definitive", () => {
    expect(isTransientApiError(new Error("boom"))).toBe(false);
  });
});

describe("isAuthApiError", () => {
  it.each([401, 403])("recognises APIError %s", (status) => {
    expect(isAuthApiError(new APIError("x", status, "x"))).toBe(true);
  });

  it("rejects other statuses and error shapes", () => {
    expect(isAuthApiError(new APIError("x", 500, "x"))).toBe(false);
    expect(isAuthApiError(new Error("Unauthorized"))).toBe(false);
  });
});

describe("withTransientRetry", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // No jitter, so the schedule under test is the nominal one.
    jest.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** Runs the retry loop to completion, letting every backoff elapse. */
  async function settle<T>(promise: Promise<T>): Promise<T> {
    const settled = promise.then(
      (value): { ok: true; value: T } => ({ ok: true, value }),
      (error: unknown): { ok: false; error: unknown } => ({ ok: false, error }),
    );
    await jest.runAllTimersAsync();
    const outcome = await settled;
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  it("returns the first result without retrying on success", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    await expect(settle(withTransientRetry(fn))).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("recovers when the first attempt fails transiently", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new APIError("x", 503, "Service Unavailable"))
      .mockResolvedValueOnce("recovered");
    await expect(settle(withTransientRetry(fn))).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry definitive failures", async () => {
    const fn = jest.fn().mockRejectedValue(new APIError("x", 404, "Not Found"));
    await expect(settle(withTransientRetry(fn))).rejects.toMatchObject({
      status: 404,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // A database connection drop lasts about a second. A single retry 250ms
  // later landed inside the same outage, so the learner saw the error anyway.
  it("waits long enough to outlast a one-second connection blip", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new APIError("x", 503, "x"))
      .mockResolvedValueOnce("ok");

    const pending = withTransientRetry(fn);
    await jest.advanceTimersByTimeAsync(900);
    expect(fn).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(2);
    await expect(pending).resolves.toBe("ok");
  });

  it("backs off further before a second retry, then gives up", async () => {
    const fn = jest.fn().mockRejectedValue(new APIError("x", 503, "x"));

    const pending = settle(withTransientRetry(fn));

    await expect(pending).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("retries an interrupted response only once", async () => {
    const fn = jest
      .fn()
      .mockRejectedValue(new NetworkError("cut off", "interrupted"));

    await expect(settle(withTransientRetry(fn))).rejects.toMatchObject({
      kind: "interrupted",
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // A 504 that arrives after the 30s proxy timeout has already cost the
  // learner half a minute; retrying it would double or triple that wait.
  it("does not retry a transient failure that was itself slow", async () => {
    let clock = 0;
    jest.spyOn(Date, "now").mockImplementation(() => clock);
    const fn = jest.fn().mockImplementation(async () => {
      clock += 30_000;
      throw new APIError("x", 504, "Gateway Timeout");
    });

    await expect(settle(withTransientRetry(fn))).rejects.toMatchObject({
      status: 504,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
