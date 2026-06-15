import "reflect-metadata";
import { AdminReportsController } from "./admin-report.controller";

const service = {
  sendBugRenewalEmail: jest.fn(),
};

const childLogger = { info: jest.fn() };
const parentLogger = { child: jest.fn().mockReturnValue(childLogger) };

const make = () =>
  new AdminReportsController(service as never, parentLogger as never);

// Minimal Express-request stub: the controller reads the gateway-injected
// `user-session` header plus the request-id headers via `.get()`.
const req = (userSession?: string) =>
  ({
    headers: userSession === undefined ? {} : { "user-session": userSession },
    get: jest.fn().mockReturnValue(undefined),
  }) as never;

describe("AdminReportsController", () => {
  beforeEach(() => jest.clearAllMocks());

  it("delegates to the service and returns its result", async () => {
    const result = { success: true, message: "ok", reportId: 7 };
    service.sendBugRenewalEmail.mockResolvedValue(result);

    const dto = { issueNumber: 1639 };
    const out = await make().sendBugRenewalEmail(
      dto as never,
      req(JSON.stringify({ userId: "ci-renewal-bot" })),
    );

    expect(service.sendBugRenewalEmail).toHaveBeenCalledWith(dto);
    expect(out).toBe(result);
  });

  it("audit-logs the actor parsed from the forwarded user-session header", async () => {
    service.sendBugRenewalEmail.mockResolvedValue({
      success: true,
      message: "ok",
      reportId: 7,
      skipped: false,
    });

    await make().sendBugRenewalEmail(
      { issueNumber: 1639 } as never,
      req(JSON.stringify({ userId: "ci-renewal-bot" })),
    );

    expect(childLogger.info).toHaveBeenCalledWith(
      "admin_renewal_email",
      expect.objectContaining({
        actor_user_id: "ci-renewal-bot",
        issue_number: 1639,
        report_id: 7,
        sent: true,
        skipped: false,
      }),
    );
  });

  it("falls back to 'unknown' actor when the header is missing or malformed", async () => {
    service.sendBugRenewalEmail.mockResolvedValue({
      success: true,
      message: "ok",
      reportId: 7,
    });

    await make().sendBugRenewalEmail({ issueNumber: 1 } as never, req());
    expect(childLogger.info).toHaveBeenLastCalledWith(
      "admin_renewal_email",
      expect.objectContaining({ actor_user_id: "unknown" }),
    );

    await make().sendBugRenewalEmail(
      { issueNumber: 1 } as never,
      req("not-json"),
    );
    expect(childLogger.info).toHaveBeenLastCalledWith(
      "admin_renewal_email",
      expect.objectContaining({ actor_user_id: "unknown" }),
    );
  });

});
