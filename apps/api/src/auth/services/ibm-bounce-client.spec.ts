import axios from "axios";
import { IbmBounceClient } from "./ibm-bounce-client";
import { parseBounce } from "./email-bounce-source";

jest.mock("axios");
jest.mock("ibm-cloud-sdk-core", () => ({
  IamTokenManager: jest
    .fn()
    .mockImplementation(() => ({
      getToken: jest.fn().mockResolvedValue("test-token"),
    })),
}));

const row = {
  email_address: "Learner@Example.com",
  subject: "Grade notification",
  error_message: "UNKNOWN_USER",
  timestamp: "2026-10-27T12:00:00Z",
};

describe("IBM bounce contract", () => {
  const originalEnvironment = { ...process.env };
  const get = axios.get as jest.Mock;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EMAIL_BOUNCE_API_KEY = "test-key";
    process.env.EMAIL_BOUNCE_API_URL =
      "https://us-south.event-notifications.cloud.ibm.com/event-notifications";
  });
  afterAll(() => {
    process.env = originalEnvironment;
  });
  const page = () =>
    new IbmBounceClient().page(
      "instance/config",
      new Date("2026-10-01T00:00:00Z"),
      new Date("2026-10-28T00:00:00Z"),
      100,
    );

  it("scopes and paginates the request, with IAM and an explicit user agent", async () => {
    get.mockResolvedValue({ data: { metrics: [row], total_count: 101 } });
    expect(await page()).toEqual({
      events: [parseBounce(row, "instance/config")],
      total: 101,
    });
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining("/instances/instance/metrics/bounce"),
      expect.objectContaining({
        timeout: 20_000,
        maxRedirects: 0,
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "User-Agent": "Mark-Email-Bounce-Poller/1.0",
        }),
        params: {
          smtp_config_id: "config",
          gte: "2026-10-01T00:00:00Z",
          lte: "2026-10-28T00:00:00Z",
          limit: 100,
          offset: 100,
        },
      }),
    );
  });

  it("does not accept a count-only response as a successful empty page", async () => {
    get.mockResolvedValue({ data: { total_count: 12 } });
    await expect(page()).rejects.toThrow("Invalid IBM bounce page");
  });

  it("rejects malformed and out-of-window records", async () => {
    get.mockResolvedValue({
      data: {
        metrics: [{ ...row, timestamp: "2026-10-29T00:00:00Z" }],
        total_count: 1,
      },
    });
    await expect(page()).rejects.toThrow("outside requested bounds");
    expect(() =>
      parseBounce({ ...row, email_address: "bad" }, "source"),
    ).toThrow();
    expect(() => parseBounce({ ...row, timestamp: "bad" }, "source")).toThrow();
  });

  it("fingerprints normalized rows but distinguishes different sends and configurations", () => {
    const event = parseBounce(row, "source");
    expect(
      parseBounce(
        {
          ...row,
          email_address: "learner@example.com",
          timestamp: "2026-10-27T12:00:00.000Z",
        },
        "source",
      ).id,
    ).toBe(event.id);
    expect(
      parseBounce({ ...row, timestamp: "2026-10-27T12:00:01Z" }, "source").id,
    ).not.toBe(event.id);
    expect(parseBounce(row, "other-source").id).not.toBe(event.id);
    expect(event).not.toHaveProperty("subject");
  });

  it("preserves unrecognized diagnostics without converting them to UNKNOWN_USER", () => {
    expect(
      parseBounce(
        { ...row, error_message: "Policy failed: UNKNOWN_USER?" },
        "source",
      ).reason,
    ).not.toBe("UNKNOWN_USER");
  });
});
