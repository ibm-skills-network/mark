import {
  MAX_DIAGNOSTICS_BYTES,
  sanitizeReportDiagnostics,
  summarizeReportDiagnostics,
} from "./report-diagnostics";

const valid = () => ({
  v: 1,
  capturedAt: "2026-09-17T15:00:00.000Z",
  session: {
    attemptId: 1630573,
    assignmentId: 3723,
    role: "learner",
    uiLanguage: "es",
    attemptLanguage: "es",
    buildVersion: "2.7.1",
  },
  page: {
    url: "https://mark.example.test/learner/3723/questions?lang=es",
    userAgent: "Mozilla/5.0",
    viewport: "1400x1000",
    inIframe: true,
    clockSkewMs: -42,
  },
  draft: {
    activeAttemptId: 1630573,
    questions: [{ id: 29377, status: "edited", selected: ["1"], textLength: 0 }],
  },
  rendered: [
    {
      questionId: 29377,
      type: "SINGLE_CORRECT",
      choices: [
        { text: "Apache Kafka and Apache Flink", selected: true },
        { text: "Apache Hadoop and Apache Spark", selected: false },
      ],
    },
  ],
  requests: [
    {
      method: "PATCH",
      path: "/api/v2/assignments/3723/attempts/1630573",
      status: 504,
      ms: 30011,
      requestId: "bcbd8b715d12",
      at: "2026-09-17T14:59:58.000Z",
    },
  ],
});

describe("sanitizeReportDiagnostics", () => {
  it("keeps a well-formed payload", () => {
    const result = sanitizeReportDiagnostics(JSON.stringify(valid()));
    expect(result).toEqual(valid());
  });

  it.each([
    ["nothing", undefined],
    ["an empty string", ""],
    ["text that is not JSON", "{nope"],
    ["a JSON array", "[1,2]"],
    ["a JSON primitive", "42"],
    ["an object the client already parsed", { v: 1 }],
  ])("returns undefined for %s", (_label, input) => {
    expect(sanitizeReportDiagnostics(input)).toBeUndefined();
  });

  it("refuses a payload over the size cap without parsing it", () => {
    const huge = JSON.stringify({
      ...valid(),
      page: { url: "x".repeat(MAX_DIAGNOSTICS_BYTES) },
    });
    expect(sanitizeReportDiagnostics(huge)).toBeUndefined();
  });

  it("drops keys it does not know, at every level", () => {
    const input = valid() as Record<string, any>;
    input.isAdmin = true;
    input.session.cookie = "authentication=secret";
    input.rendered[0].choices[0].isCorrect = true;
    input.requests[0].body = { learnerTextResponse: "my answer" };

    const result = sanitizeReportDiagnostics(JSON.stringify(input));

    expect(result).toEqual(valid());
  });

  it("drops values of the wrong type rather than coercing them", () => {
    const input = valid() as Record<string, any>;
    input.session.attemptId = "1630573; DROP TABLE";
    input.page.inIframe = "yes";
    input.requests[0].status = "504";

    const result = sanitizeReportDiagnostics(JSON.stringify(input));

    expect(result?.session?.attemptId).toBeUndefined();
    expect(result?.page?.inIframe).toBeUndefined();
    expect(result?.requests?.[0].status).toBeNull();
  });

  it("bounds every list and every string", () => {
    const input = valid() as Record<string, any>;
    // Sized to stay under the byte cap, so bounding is what is exercised.
    input.page.url = `https://mark.example.test/${"a".repeat(2000)}`;
    input.requests = Array.from({ length: 60 }, () => valid().requests[0]);
    input.rendered = [
      {
        questionId: 1,
        choices: Array.from({ length: 30 }, () => ({
          text: "c".repeat(1000),
          selected: false,
        })),
      },
    ];

    const result = sanitizeReportDiagnostics(JSON.stringify(input));

    expect(result?.page?.url?.length).toBeLessThanOrEqual(500);
    expect(result?.requests?.length).toBeLessThanOrEqual(20);
    expect(result?.rendered?.[0].choices.length).toBeLessThanOrEqual(12);
    expect(result?.rendered?.[0].choices[0].text.length).toBeLessThanOrEqual(
      300,
    );
  });

  it("strips the query string from recorded request paths", () => {
    const input = valid();
    input.requests[0].path = "/api/v1/github/callback?code=secret&state=1";

    const result = sanitizeReportDiagnostics(JSON.stringify(input));

    expect(result?.requests?.[0].path).toBe("/api/v1/github/callback");
  });
});

describe("summarizeReportDiagnostics", () => {
  it("describes the capture in one line without any captured content", () => {
    const summary = summarizeReportDiagnostics(valid());

    expect(summary).toBe(
      "Diagnostics captured: attempt 1630573, language es, 1 of 1 recent requests failed. Full capture: Mark admin > Reports.",
    );
    expect(summary).not.toContain("Apache");
  });
});
