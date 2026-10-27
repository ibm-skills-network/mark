import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/http/app.js";
import { asciiJson } from "../helpers/ascii-json.js";
import { captureLogger, fakePrisma, testConfig } from "../http/helpers.js";

// Expected bodies are what the legacy API returns for the same header.
async function userSession(session: Record<string, unknown>) {
  const { logger } = captureLogger();
  const app = await buildApp({
    config: testConfig(),
    logger,
    prisma: fakePrisma(() => Promise.resolve([])),
  });
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/user-session",
    headers: { "user-session": asciiJson(session) },
  });
  await app.close();
  return res;
}

const gatewaySession = {
  userId: "learner@example.com",
  role: "learner",
  groupId: "course-v1:IBM+X+2026",
  assignmentId: 2300,
  gradingCallbackRequired: true,
  returnUrl: "https://lms.example.org/courses/1/return",
  launch_presentation_locale: null,
  lisOutcomeServiceUrl: "https://WWW.Coursera.org/api/onDemandLtiOutcomes",
  toolConsumerInstanceGuid: "coursera.org",
  courseTitle: "Données et IA — 入門",
  courseId: "IBM-DS0101",
  activityTitle: "Lab 3",
  toolConsumerProductFamilyCode: "coursera",
};

describe("user-session matches legacy for gateway-shaped sessions", () => {
  it("full gateway session: launch extras are dropped, null locale kept", async () => {
    const res = await userSession(gatewaySession);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(
      '{"userId":"learner@example.com","role":"learner","assignmentId":2300,"returnUrl":"https://lms.example.org/courses/1/return","launch_presentation_locale":null,"lmsHost":"coursera.org"}',
    );
  });

  it.each([
    [
      "internationalised host is punycoded",
      "https://bücher.de/lti",
      "xn--bcher-kva.de",
    ],
    ["IPv6 literal keeps its brackets", "http://[::1]:8080/out", "[::1]"],
    [
      "trailing-dot host keeps the dot",
      "https://www.Example.com.:443/x",
      "example.com.",
    ],
    ["bare www. host leaves an empty string", "http://www./", ""],
  ])("lmsHost: %s", async (_name, url, host) => {
    const res = await userSession({
      userId: "a@b.co",
      role: "learner",
      assignmentId: 1,
      lisOutcomeServiceUrl: url,
    });
    expect(res.body).toBe(
      `{"userId":"a@b.co","role":"learner","assignmentId":1,"lmsHost":${JSON.stringify(host)}}`,
    );
  });

  it("admin role is echoed like legacy", async () => {
    const res = await userSession({
      userId: "admin@b.co",
      role: "admin",
      assignmentId: 3,
    });
    expect(res.body).toBe(
      '{"userId":"admin@b.co","role":"admin","assignmentId":3}',
    );
  });

  it("non-ASCII user id round-trips through the escaped header", async () => {
    const res = await userSession({
      userId: "zoë@exämple.com",
      role: "author",
      assignmentId: 9,
    });
    expect(res.body).toBe(
      '{"userId":"zoë@exämple.com","role":"author","assignmentId":9}',
    );
  });
});
