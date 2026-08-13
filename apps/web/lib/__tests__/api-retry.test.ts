/**
 * @jest-environment node
 */

import { APIError } from "../api-client";
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
  it("returns the first result without retrying on success", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    await expect(withTransientRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first attempt fails transiently", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new APIError("x", 503, "Service Unavailable"))
      .mockResolvedValueOnce("recovered");
    await expect(withTransientRetry(fn)).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry definitive failures", async () => {
    const fn = jest.fn().mockRejectedValue(new APIError("x", 404, "Not Found"));
    await expect(withTransientRetry(fn)).rejects.toMatchObject({ status: 404 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after a single retry", async () => {
    const fn = jest.fn().mockRejectedValue(new APIError("x", 503, "x"));
    await expect(withTransientRetry(fn)).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
