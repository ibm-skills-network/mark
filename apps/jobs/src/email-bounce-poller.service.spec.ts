import { PrismaService } from "../../api/src/database/prisma.service";
import { EmailSuppressionService } from "../../api/src/auth/services/email-suppression.service";
import { IbmBounceClient } from "../../api/src/auth/services/ibm-bounce-client";
import { EmailBouncePoller } from "./email-bounce-poller.service";
import {
  parseBounce,
  DAY_MS,
} from "../../api/src/auth/services/email-bounce-source";

jest.mock("node:timers/promises", () => ({
  setTimeout: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../api/src/auth/services/ibm-bounce-client", () => ({
  IbmBounceClient: jest.fn(),
}));

describe("EmailBouncePoller", () => {
  const environment = { ...process.env };
  const state = { upsert: jest.fn(), updateMany: jest.fn() };
  const client = { page: jest.fn() };
  const suppressions = { recordBounce: jest.fn(), bounceHealth: jest.fn() };
  const service = new EmailBouncePoller(
    { emailBouncePollState: state } as unknown as PrismaService,
    client as unknown as IbmBounceClient,
    suppressions as unknown as EmailSuppressionService,
  );
  const first = parseBounce(
    {
      email_address: "one@example.com",
      timestamp: "2026-10-27T00:00:00Z",
      error_message: "UNKNOWN_USER",
      subject: "test",
    },
    "instance/config",
  );

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2026-10-28T12:00:00Z"));
    process.env.ENABLE_JOB_SCHEDULERS = "true";
    process.env.EMAIL_BOUNCE_POLL_ENABLED = "true";
    process.env.EMAIL_BOUNCE_INSTANCE_ID = "instance";
    process.env.EMAIL_BOUNCE_SMTP_CONFIG_ID = "config";
    state.upsert.mockResolvedValue({});
    state.updateMany.mockResolvedValue({ count: 1 });
    suppressions.bounceHealth.mockResolvedValue({ domains: [] });
    suppressions.recordBounce.mockResolvedValue(undefined);
  });
  afterEach(() => jest.useRealTimers());
  afterAll(() => {
    process.env = environment;
  });

  it("is disabled by default and respects the jobs scheduler switch", async () => {
    delete process.env.EMAIL_BOUNCE_POLL_ENABLED;
    await service.poll();
    process.env.EMAIL_BOUNCE_POLL_ENABLED = "true";
    process.env.ENABLE_JOB_SCHEDULERS = "false";
    await service.poll();
    expect(state.upsert).not.toHaveBeenCalled();
  });

  it("does not poll while another worker owns the lease", async () => {
    state.updateMany.mockResolvedValue({ count: 0 });
    await service.poll();
    expect(client.page).not.toHaveBeenCalled();
  });

  it("ingests every page with a fixed overlapping window then records success", async () => {
    client.page
      .mockResolvedValueOnce({ events: [first], total: 2 })
      .mockResolvedValueOnce({
        events: [{ ...first, id: "second" }],
        total: 2,
      });
    await service.poll();
    const [, start, end, offset] = client.page.mock.calls[0] as [
      string,
      Date,
      Date,
      number,
    ];
    expect(end.getTime()).toBe(Date.now() - 60_000);
    expect(end.getTime() - start.getTime()).toBe(30 * DAY_MS);
    expect(offset).toBe(0);
    expect(client.page).toHaveBeenLastCalledWith(
      "instance/config",
      start,
      end,
      1,
    );
    expect(suppressions.recordBounce).toHaveBeenCalledTimes(2);
    expect(state.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastSuccessAt: expect.any(Date),
          lastError: null,
          leaseUntil: null,
        }),
      }),
    );
  });

  it("keeps success unchanged on partial failure and honors Retry-After without logging credentials", async () => {
    client.page
      .mockResolvedValueOnce({ events: [first], total: 2 })
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 429, headers: { "retry-after": "3600" } },
        config: { headers: { Authorization: "secret" } },
      });
    await service.poll();
    expect(suppressions.recordBounce).toHaveBeenCalledWith(first);
    expect(state.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          lastError: "IBM HTTP 429",
          leaseToken: null,
          leaseUntil: new Date(Date.now() + 3_600_000),
        },
      }),
    );
    expect(
      state.updateMany.mock.calls.some(([call]) => call.data.lastSuccessAt),
    ).toBe(false);
  });

  it("does not declare success for a truncated response", async () => {
    client.page.mockResolvedValue({ events: [], total: 10 });
    await service.poll();
    expect(
      state.updateMany.mock.calls.some(([call]) => call.data.lastSuccessAt),
    ).toBe(false);
  });

  it("stops fetching when it loses its lease", async () => {
    state.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValue({ count: 0 });
    await service.poll();
    expect(client.page).not.toHaveBeenCalled();
  });
});
