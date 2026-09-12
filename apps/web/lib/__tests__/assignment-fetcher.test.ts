/**
 * @jest-environment node
 */

import { APIError, NetworkError } from "../api-client";
import { getAssignment } from "../shared";

jest.mock("../api-client", () => {
  const actual = jest.requireActual("../api-client");
  return {
    ...actual,
    apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
  };
});

// Retry pauses briefly between attempts; keep tests instant.
jest.mock("../api-retry", () => {
  const actual = jest.requireActual("../api-retry");
  return {
    ...actual,
    withTransientRetry: async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (error) {
        if (!actual.isTransientApiError(error)) throw error;
        return fn();
      }
    },
  };
});

const { apiClient }: { apiClient: { get: jest.Mock } } =
  jest.requireMock("../api-client");

const assignmentRow = { success: true, id: 42, name: "Quiz" };

beforeEach(() => {
  apiClient.get.mockReset();
});

// getAssignment is the one call the About page cannot render without, and it
// was the only learner fetch left without the retry its siblings (getAttempt,
// getAttempts) already had — so a single dropped socket went straight to the
// error dialog.
describe("getAssignment", () => {
  it("recovers when the first request fails transiently", async () => {
    apiClient.get
      .mockRejectedValueOnce(new APIError("x", 503, "Service Unavailable"))
      .mockResolvedValueOnce(assignmentRow);

    const assignment = await getAssignment(42);

    expect(assignment).toEqual(expect.objectContaining({ id: 42 }));
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it("recovers when the connection drops mid-request", async () => {
    apiClient.get
      .mockRejectedValueOnce(
        new NetworkError("Could not reach the server", "unreachable"),
      )
      .mockResolvedValueOnce(assignmentRow);

    await expect(getAssignment(42)).resolves.toEqual(
      expect.objectContaining({ id: 42 }),
    );
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  // Only callers that render the failure themselves may silence the toast;
  // for everyone else it is the sole signal that anything went wrong.
  it("stays loud unless the caller says it renders the error itself", async () => {
    apiClient.get.mockResolvedValue(assignmentRow);

    await getAssignment(42);
    expect(apiClient.get).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ quiet: false }),
    );

    await getAssignment(42, "en", undefined, { quiet: true });
    expect(apiClient.get).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ quiet: true }),
    );
  });

  it("propagates a definitive failure without retrying", async () => {
    apiClient.get.mockRejectedValue(new APIError("x", 403, "Forbidden"));

    await expect(getAssignment(42)).rejects.toMatchObject({ status: 403 });
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  // A request that already burned the full client timeout must not burn a
  // second one: two minutes of spinner is worse than telling the learner and
  // offering a retry.
  it("does not retry a request that already timed out", async () => {
    apiClient.get.mockRejectedValue(
      new NetworkError("The request timed out", "timeout"),
    );

    await expect(getAssignment(42)).rejects.toMatchObject({
      kind: "timeout",
    });
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });
});
