import request from "supertest";
import { parseUserSession } from "../../src/v3/core/principal";
import { createV3TestApp, type V3TestApp } from "./helpers/v3-test-app";

// Contract: the gateway's user-session header becomes a Principal or a
// refusal with one enumerated reason; header content is never logged.
const valid = {
  userId: "a@b.c",
  role: "learner",
  groupId: "g",
  assignmentId: 12,
  gradingCallbackRequired: false,
};

const refusals: Array<[string, string | undefined, number, string]> = [
  ["missing", undefined, 401, "missing"],
  ["empty", "", 401, "missing"],
  ["invalid json", "{nope", 400, "invalid_json"],
  ["array", "[]", 400, "not_an_object"],
  ["null", "null", 400, "not_an_object"],
  ["string", '"x"', 400, "not_an_object"],
  [
    "userId number",
    JSON.stringify({ ...valid, userId: 5 }),
    400,
    "userId_not_string",
  ],
  [
    "role number",
    JSON.stringify({ ...valid, role: 1 }),
    400,
    "role_not_string",
  ],
  [
    "groupId number",
    JSON.stringify({ ...valid, groupId: 1 }),
    400,
    "groupId_not_string",
  ],
  [
    "assignmentId string",
    JSON.stringify({ ...valid, assignmentId: "12" }),
    400,
    "assignmentId_not_number",
  ],
  [
    "assignmentId non-finite",
    '{"userId":"a","role":"learner","assignmentId":1e999}',
    400,
    "assignmentId_not_number",
  ],
  [
    "role unknown",
    JSON.stringify({ ...valid, role: "root" }),
    400,
    "role_unknown",
  ],
  [
    "userId empty",
    JSON.stringify({ ...valid, userId: "" }),
    400,
    "userId_empty",
  ],
  [
    "gradingCallbackRequired not boolean",
    JSON.stringify({ ...valid, gradingCallbackRequired: "yes" }),
    400,
    "gradingCallbackRequired_not_boolean",
  ],
];

describe("parseUserSession", () => {
  it("parses a valid header and keeps the raw object", () => {
    expect(parseUserSession(JSON.stringify(valid))).toEqual({
      userId: "a@b.c",
      role: "learner",
      groupId: "g",
      assignmentId: 12,
      gradingCallbackRequired: false,
      raw: valid,
    });
  });

  it("defaults optional fields", () => {
    expect(parseUserSession('{"userId":"a","role":"admin"}')).toEqual({
      userId: "a",
      role: "admin",
      groupId: null,
      assignmentId: null,
      gradingCallbackRequired: false,
      raw: { userId: "a", role: "admin" },
    });
  });

  it("decodes the gateway's \\u escapes", () => {
    expect(
      parseUserSession('{"userId":"j\\u00fcrgen@b.c","role":"author"}').userId,
    ).toBe("jürgen@b.c");
  });
});

describe("principal over HTTP", () => {
  let t: V3TestApp;
  beforeAll(async () => {
    t = await createV3TestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(() => {
    t.logs.length = 0;
  });

  it.each(refusals)("refuses %s", async (_name, header, status, reason) => {
    const req = request(t.app.getHttpServer())
      .get("/api/v3/probe/whoami")
      .set("x-request-id", "rid");
    if (header !== undefined) req.set("user-session", header);
    const res = await req;
    expect(res.status).toBe(status);
    expect(t.logs.filter((l) => l.event === "v3.request.rejected")).toEqual([
      expect.objectContaining({ reason, request_id: "rid" }),
    ]);
    // Long enough not to collide with ordinary log values like "null".
    if (header && header.length > 12) {
      expect(JSON.stringify(t.logs)).not.toContain(header);
    }
  });
});
