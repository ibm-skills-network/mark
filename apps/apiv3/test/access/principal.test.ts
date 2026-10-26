import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildApp } from "../../src/http/app.js";
import { requirePrincipal } from "../../src/modules/access/plugin.js";
import { parseUserSession } from "../../src/modules/access/principal.js";
import { BadRequestError, UnauthorizedError } from "../../src/shared/errors.js";
import { captureLogger, fakePrisma, testConfig } from "../http/helpers.js";

const whoami = z.object({ userId: z.string() });

const valid = {
  userId: "a@b.c",
  role: "learner",
  groupId: "g",
  assignmentId: 12,
  gradingCallbackRequired: false,
};

async function appWithPrincipal() {
  const { logger, lines } = captureLogger();
  const app = await buildApp({
    config: testConfig(),
    logger,
    prisma: fakePrisma(() => Promise.resolve([])),
  });
  await app.register((scope, _opts, done) => {
    requirePrincipal(scope);
    scope.get(
      "/whoami",
      { schema: { response: { 200: whoami } } },
      (request) => ({ userId: request.principal.userId }),
    );
    done();
  });
  return { app, lines };
}

const refusals: Array<{
  name: string;
  header: string | undefined;
  status: number;
  reason: string;
}> = [
  { name: "missing", header: undefined, status: 401, reason: "missing" },
  { name: "empty", header: "", status: 401, reason: "missing" },
  {
    name: "invalid json",
    header: "{nope",
    status: 400,
    reason: "invalid_json",
  },
  { name: "array", header: "[]", status: 400, reason: "not_an_object" },
  { name: "null", header: "null", status: 400, reason: "not_an_object" },
  { name: "string", header: '"x"', status: 400, reason: "not_an_object" },
  {
    name: "userId number",
    header: JSON.stringify({ ...valid, userId: 5 }),
    status: 400,
    reason: "userId_not_string",
  },
  {
    name: "role number",
    header: JSON.stringify({ ...valid, role: 1 }),
    status: 400,
    reason: "role_not_string",
  },
  {
    name: "groupId number",
    header: JSON.stringify({ ...valid, groupId: 1 }),
    status: 400,
    reason: "groupId_not_string",
  },
  {
    name: "assignmentId string",
    header: JSON.stringify({ ...valid, assignmentId: "12" }),
    status: 400,
    reason: "assignmentId_not_number",
  },
  {
    name: "assignmentId non-finite",
    header: '{"userId":"a","role":"learner","assignmentId":1e999}',
    status: 400,
    reason: "assignmentId_not_number",
  },
  {
    name: "role unknown",
    header: JSON.stringify({ ...valid, role: "root" }),
    status: 400,
    reason: "role_unknown",
  },
  {
    name: "userId empty",
    header: JSON.stringify({ ...valid, userId: "" }),
    status: 400,
    reason: "userId_empty",
  },
  {
    name: "gradingCallbackRequired not boolean",
    header: JSON.stringify({ ...valid, gradingCallbackRequired: "yes" }),
    status: 400,
    reason: "gradingCallbackRequired_not_boolean",
  },
];

describe("parseUserSession", () => {
  it("parses a valid header", () => {
    const p = parseUserSession(JSON.stringify(valid));
    expect(p).toEqual({
      userId: "a@b.c",
      role: "learner",
      groupId: "g",
      assignmentId: 12,
      gradingCallbackRequired: false,
      raw: valid,
    });
  });

  it("defaults optional fields", () => {
    const p = parseUserSession('{"userId":"a","role":"admin"}');
    expect(p.groupId).toBeNull();
    expect(p.assignmentId).toBeNull();
    expect(p.gradingCallbackRequired).toBe(false);
  });

  it("decodes non-ASCII unicode escapes", () => {
    const p = parseUserSession('{"userId":"j\\u00fcrgen@b.c","role":"author"}');
    expect(p.userId).toBe("jürgen@b.c");
  });

  it("throws the right error class", () => {
    expect(() => parseUserSession(undefined)).toThrow(UnauthorizedError);
    expect(() => parseUserSession("{")).toThrow(BadRequestError);
  });
});

describe("requirePrincipal", () => {
  it("exposes the principal to routes", async () => {
    const { app } = await appWithPrincipal();
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: { "user-session": JSON.stringify(valid) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: "a@b.c" });
    await app.close();
  });

  it.each(refusals)("refuses $name", async ({ header, status, reason }) => {
    const { app, lines } = await appWithPrincipal();
    const res = await app.inject({
      method: "GET",
      url: "/whoami",
      headers: header === undefined ? {} : { "user-session": header },
    });
    expect(res.statusCode).toBe(status);
    const body = res.json<{ code: string; message: string }>();
    expect(body.message).not.toContain(reason);
    const warn = lines.find((l) => l.msg === "session.rejected");
    expect(warn).toMatchObject({ level: 40, reason });
    expect(warn?.requestId).toBe(res.headers["x-request-id"]);
    if (header) {
      expect(JSON.stringify(lines)).not.toContain(header.replace(/"/g, '\\"'));
    }
    await app.close();
  });

  it("leaves health routes open without a header", async () => {
    const { app } = await appWithPrincipal();
    const res = await app.inject({ method: "GET", url: "/health/liveness" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("can be called twice in one scope, in sibling scopes and nested", async () => {
    const { logger } = captureLogger();
    const app = await buildApp({
      config: testConfig(),
      logger,
      prisma: fakePrisma(() => Promise.resolve([])),
    });
    const route = { schema: { response: { 200: whoami } } };
    for (const prefix of ["/a", "/b"]) {
      await app.register(
        (scope, _opts, done) => {
          requirePrincipal(scope);
          // A second call in the same scope used to re-decorate and throw.
          requirePrincipal(scope);
          scope.get("/me", route, (request) => ({
            userId: request.principal.userId,
          }));
          void scope.register(
            (inner, _innerOpts, innerDone) => {
              requirePrincipal(inner);
              inner.get("/me", route, (request) => ({
                userId: request.principal.userId,
              }));
              innerDone();
            },
            { prefix: "/inner" },
          );
          done();
        },
        { prefix },
      );
    }
    await app.ready();
    for (const url of ["/a/me", "/b/me", "/a/inner/me"]) {
      const res = await app.inject({
        method: "GET",
        url,
        headers: { "user-session": JSON.stringify(valid) },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ userId: "a@b.c" });
    }
    const refused = await app.inject({ method: "GET", url: "/a/inner/me" });
    expect(refused.statusCode).toBe(401);
    await app.close();
  });
});
