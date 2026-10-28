import request from "supertest";
import {
  createV3TestApp,
  FakeInstana,
  learner,
  type LogEntry,
  type V3TestApp,
} from "./helpers/v3-test-app";

// Contract: every v3 log line carries the request context without the code
// passing it along; secrets are redacted, long strings cut; Instana spans
// get the same ids; one outcome line per request.
const worked = (logs: LogEntry[]) =>
  logs.filter((l) => l.event === "probe.worked");

describe("v3 logging and tracing", () => {
  let t: V3TestApp;
  beforeAll(async () => {
    t = await createV3TestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(() => {
    t.logs.length = 0;
    t.instana.annotations.length = 0;
  });

  const whoami = (session: object, rid: string) =>
    request(t.app.getHttpServer())
      .get("/api/v3/probe/whoami")
      .set("x-request-id", rid)
      .set("user-session", JSON.stringify(session));

  it("adds request context to a line logged deep in a service", async () => {
    await whoami(learner, "rid-ctx");
    expect(worked(t.logs)).toEqual([
      expect.objectContaining({
        level: "info",
        event: "probe.worked",
        component: "probe",
        request_id: "rid-ctx",
        trace_id: "trace-abc",
        user_id: "a@b.co",
        role: "learner",
        assignment_id: 7,
        attempt_id: 42,
      }),
    ]);
  });

  it("redacts secret-named fields and truncates long strings", async () => {
    await whoami(learner, "rid-redact");
    const [line] = worked(t.logs);
    expect(line.cookie).toBe("[redacted]");
    expect(line.password).toBe("[redacted]");
    expect(line.note).toBe(`${"x".repeat(2000)}…[truncated]`);
    expect(JSON.stringify(t.logs)).not.toContain("secret-cookie");
    expect(JSON.stringify(t.logs)).not.toContain("hunter2");
  });

  it("writes one outcome line per request", async () => {
    await whoami(learner, "rid-out");
    const outcome = t.logs.filter((l) => l.event === "v3.request.completed");
    expect(outcome).toEqual([
      expect.objectContaining({
        request_id: "rid-out",
        route: "GET /api/v3/probe/whoami",
        status: 200,
        outcome: "ok",
        user_id: "a@b.co",
      }),
    ]);
    expect(typeof outcome[0].duration_ms).toBe("number");
  });

  it("tags the Instana span with the context ids", async () => {
    await whoami(learner, "rid-span");
    expect(t.instana.annotations).toEqual(
      expect.arrayContaining([
        ["sdk.custom.tags.request_id", "rid-span"],
        ["sdk.custom.tags.user_id", "a@b.co"],
        ["sdk.custom.tags.role", "learner"],
        ["sdk.custom.tags.assignment_id", 7],
      ]),
    );
  });

  it("keeps concurrent requests' context apart", async () => {
    const other = { ...learner, userId: "z@y.co", assignmentId: 8 };
    await Promise.all([
      whoami(learner, "rid-a"),
      whoami(other, "rid-b"),
      whoami(learner, "rid-c"),
      whoami(other, "rid-d"),
    ]);
    const byRequest = Object.fromEntries(
      worked(t.logs).map((l) => [l.request_id, [l.user_id, l.assignment_id]]),
    );
    expect(byRequest).toEqual({
      "rid-a": ["a@b.co", 7],
      "rid-b": ["z@y.co", 8],
      "rid-c": ["a@b.co", 7],
      "rid-d": ["z@y.co", 8],
    });
  });
});

describe("v3 logging without Instana", () => {
  it("logs a null trace id and still serves the request", async () => {
    const t = await createV3TestApp({ instana: null });
    try {
      const res = await request(t.app.getHttpServer())
        .get("/api/v3/probe/whoami")
        .set("x-request-id", "rid-none")
        .set("user-session", JSON.stringify(learner));
      expect(res.status).toBe(200);
      expect(worked(t.logs)).toEqual([
        expect.objectContaining({ request_id: "rid-none", trace_id: null }),
      ]);
    } finally {
      await t.close();
    }
  });

  it("uses the trace id Instana reports", async () => {
    const t = await createV3TestApp({ instana: new FakeInstana("t-777") });
    try {
      await request(t.app.getHttpServer())
        .get("/api/v3/probe/whoami")
        .set("user-session", JSON.stringify(learner));
      expect(worked(t.logs)[0].trace_id).toBe("t-777");
    } finally {
      await t.close();
    }
  });
});
