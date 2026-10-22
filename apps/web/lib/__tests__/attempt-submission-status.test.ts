/**
 * @jest-environment node
 */

jest.mock("../api-client", () => ({
  apiClient: { get: jest.fn() },
}));

import { apiClient } from "../api-client";
import {
  closedAttemptReason,
  getAttemptSubmissionStatus,
  type AttemptSubmissionStatus,
} from "../attempt-submission-status";

const status = (
  overrides: Partial<AttemptSubmissionStatus> = {},
): AttemptSubmissionStatus => ({
  id: 1873208,
  submitted: false,
  closedAtTimeLimit: false,
  acceptingSubmissions: true,
  expiresAt: "2026-10-21T01:16:03.499Z",
  serverNow: "2026-10-21T00:31:10.000Z",
  ...overrides,
});

describe("getAttemptSubmissionStatus", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("measures the server clock on this request, from the round-trip midpoint", async () => {
    jest.useFakeTimers();
    const sentAt = Date.parse("2026-10-21T01:16:24.000Z");
    jest.setSystemTime(sentAt);
    (apiClient.get as jest.Mock).mockImplementation(async () => {
      // 400ms round trip; the server read its clock 200ms in, 5s behind us.
      jest.setSystemTime(sentAt + 400);
      return status({ serverNow: new Date(sentAt + 200 - 5000).toISOString() });
    });

    const result = await getAttemptSubmissionStatus(771, 1873208);

    expect(apiClient.get).toHaveBeenCalledWith(
      expect.stringMatching(
        /\/assignments\/771\/attempts\/1873208\/submission-status$/,
      ),
      { quiet: true },
    );
    expect(result).toMatchObject({ ok: true, serverTimeOffsetMs: -5000 });
  });

  it("reports failure instead of throwing when the request fails", async () => {
    (apiClient.get as jest.Mock).mockRejectedValue(new Error("offline"));
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(getAttemptSubmissionStatus(771, 1)).resolves.toEqual({
      ok: false,
    });
  });

  it("rejects a response without a usable server clock", async () => {
    (apiClient.get as jest.Mock).mockResolvedValue(
      status({ serverNow: "not a date" }),
    );
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(getAttemptSubmissionStatus(771, 1)).resolves.toEqual({
      ok: false,
    });
  });
});

describe("closedAttemptReason", () => {
  it("is null while the attempt accepts submits", () => {
    expect(closedAttemptReason(status())).toBeNull();
  });

  it("names a deadline closure", () => {
    expect(
      closedAttemptReason(
        status({
          submitted: true,
          closedAtTimeLimit: true,
          acceptingSubmissions: false,
        }),
      ),
    ).toBe("time_limit");
  });

  it("names an ordinary submit", () => {
    expect(
      closedAttemptReason(
        status({ submitted: true, acceptingSubmissions: false }),
      ),
    ).toBe("submitted");
  });

  it("names an attempt past its deadline that nothing has closed yet", () => {
    expect(closedAttemptReason(status({ acceptingSubmissions: false }))).toBe(
      "expired",
    );
  });
});
