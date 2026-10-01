/**
 * @jest-environment jsdom
 */

import { buildErrorReportPrefills, submitBugReport } from "../report-client";
import { collectReportDiagnostics } from "../report-diagnostics";

jest.mock("@/lib/report-diagnostics", () => ({
  collectReportDiagnostics: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: { info: jest.fn(), success: jest.fn(), error: jest.fn() },
}));

describe("buildErrorReportPrefills", () => {
  const error = {
    statusCode: 500,
    headline: "Something went wrong on our side",
    message: "Attempts could not be fetched",
    stateTimeline: [
      { step: "Load learner layout", detail: "Assignment 42" },
      { step: "Attempts fetch failed" },
    ],
  };

  it("fills every required report field so the form submits as-is", () => {
    const prefills = buildErrorReportPrefills(error, {
      pagePath: "/learner/42/questions",
    });

    // "steps", "expected" and "actual" are the required fields of the
    // report form — all must be non-empty.
    expect(prefills.steps).toContain("/learner/42/questions");
    expect(prefills.expected).not.toHaveLength(0);
    expect(prefills.actual).toContain("500");
    expect(prefills.actual).toContain("Something went wrong on our side");
    expect(prefills.actual).toContain("Attempts could not be fetched");
  });

  it("includes the state timeline as context", () => {
    const prefills = buildErrorReportPrefills(error);
    expect(prefills.context).toContain("Load learner layout");
    expect(prefills.context).toContain("Assignment 42");
  });

  it("omits context when there is no timeline", () => {
    const prefills = buildErrorReportPrefills({
      statusCode: 500,
      headline: "x",
    });
    expect(prefills.context).toBeUndefined();
  });

  it("includes the user agent when provided", () => {
    const prefills = buildErrorReportPrefills(error, {
      userAgent: "TestBrowser/1.0",
    });
    expect(prefills.environment).toBe("TestBrowser/1.0");
  });
});

describe("submitBugReport", () => {
  const user = {
    userId: "learner@example.com",
    role: "learner" as const,
    assignmentId: 42,
    returnUrl: "",
  };

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("posts the report fields and resolves true on success", async () => {
    const ok = await submitBugReport(
      { description: "it broke", severity: "error" },
      { category: "Error Dialog Report", user },
    );

    expect(ok).toBe(true);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toMatch(/\/reports$/);
    expect(init.credentials).toBe("include");
    const body = init.body as FormData;
    expect(body.get("category")).toBe("Error Dialog Report");
    expect(body.get("severity")).toBe("error");
    expect(body.get("userRole")).toBe("learner");
    expect(body.get("userEmail")).toBe("learner@example.com");
    expect(body.get("assignmentId")).toBe("42");
  });

  it("attaches the browser capture as a hidden field", async () => {
    (collectReportDiagnostics as jest.Mock).mockReturnValue({
      v: 1,
      session: { attemptId: 84 },
    });

    await submitBugReport(
      { description: "Broken", assignmentId: 42 },
      { category: "Bug", user },
    );

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const sent = (init.body as FormData).get("diagnostics");
    expect(JSON.parse(sent as string)).toEqual({
      v: 1,
      session: { attemptId: 84 },
    });
    expect(collectReportDiagnostics).toHaveBeenCalledWith({
      role: "learner",
      assignmentId: 42,
    });
  });

  it("still submits the report when nothing could be captured", async () => {
    (collectReportDiagnostics as jest.Mock).mockReturnValue(undefined);

    const ok = await submitBugReport(
      { description: "Broken" },
      { category: "Bug", user },
    );

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect((init.body as FormData).has("diagnostics")).toBe(false);
    expect(ok).toBe(true);
  });

  it("posts the page URL and browser so the ticket carries the client context", async () => {
    await submitBugReport(
      { description: "it broke" },
      { category: "Flag Button Report", user },
    );

    const body = (global.fetch as jest.Mock).mock.calls[0][1].body as FormData;
    expect(body.get("pageUrl")).toBe(window.location.href);
    expect(typeof body.get("browser")).toBe("string");
  });

  it("lets the caller override the reporter role", async () => {
    await submitBugReport(
      { description: "it broke" },
      { category: "Issue Report", user, userRole: "author" },
    );

    const body = (global.fetch as jest.Mock).mock.calls[0][1].body as FormData;
    expect(body.get("userRole")).toBe("author");
  });

  it("resolves false and logs when the endpoint rejects", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ message: "Too many reports" }),
    });

    const ok = await submitBugReport(
      { description: "x" },
      { category: "Error Dialog Report", user },
    );

    expect(ok).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});

// Reports auto-filed from a stalled or dropped browser request used to arrive
// as "Status: 408 — Something went wrong on our side", indistinguishable from
// a real server fault. They still get filed, but tagged.
describe("buildErrorReportPrefills for a client network failure", () => {
  const networkError = {
    statusCode: 0,
    statusLabel: "Network",
    headline: "The request timed out",
    message: "We didn't get a response in time.",
    fault: "client-network" as const,
  };

  it("labels the failure as a client network problem", () => {
    const prefills = buildErrorReportPrefills(networkError, {
      pagePath: "/learner/42",
    });

    expect(prefills.actual).toContain("client network");
    expect(prefills.actual).toContain("The request timed out");
  });

  it("does not print a status the server never sent", () => {
    const prefills = buildErrorReportPrefills(networkError);

    expect(prefills.actual).not.toMatch(/\b408\b/);
    expect(prefills.actual).not.toMatch(/\b500\b/);
    expect(prefills.actual).toContain("Network");
  });

  it("leaves server-fault reports untouched", () => {
    const prefills = buildErrorReportPrefills({
      statusCode: 500,
      headline: "Something went wrong on our side",
    });

    expect(prefills.actual).toContain("500");
    expect(prefills.actual).not.toContain("client network");
  });
});
