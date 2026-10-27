import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/http/app.js";
import type { Config } from "../../src/shared/config.js";
import { captureLogger, fakePrisma, testConfig } from "../http/helpers.js";

async function app(aiFeatures?: Partial<Config["aiFeatures"]>) {
  const { logger, lines } = captureLogger();
  const instance = await buildApp({
    config: testConfig({
      aiFeatures: {
        allDisabled: false,
        gradingDisabled: false,
        chatDisabled: false,
        authoringDisabled: false,
        ...aiFeatures,
      },
    }),
    logger,
    prisma: fakePrisma(() => Promise.resolve([])),
  });
  return { instance, lines };
}

const base = { userId: "a@b.co", role: "learner" };

const cases: Array<{ name: string; header: string; body: string }> = [
  {
    name: "full learner session",
    header: JSON.stringify({
      ...base,
      groupId: "g",
      assignmentId: 7,
      returnUrl: "https://x.org/r",
      launch_presentation_locale: "fr",
      lisOutcomeServiceUrl: "https://WWW.Coursera.org/lti",
    }),
    body: '{"userId":"a@b.co","role":"learner","assignmentId":7,"returnUrl":"https://x.org/r","launch_presentation_locale":"fr","lmsHost":"coursera.org"}',
  },
  {
    name: "author with only an assignment",
    header: JSON.stringify({
      ...base,
      role: "author",
      groupId: "g",
      assignmentId: 7,
    }),
    body: '{"userId":"a@b.co","role":"author","assignmentId":7}',
  },
  {
    name: "explicit nulls stay null",
    header: JSON.stringify({ ...base, assignmentId: null, returnUrl: null }),
    body: '{"userId":"a@b.co","role":"learner","assignmentId":null,"returnUrl":null}',
  },
  {
    name: "non-http scheme gives no lmsHost",
    header: JSON.stringify({
      ...base,
      assignmentId: 7,
      lisOutcomeServiceUrl: "ftp://h.org",
    }),
    body: '{"userId":"a@b.co","role":"learner","assignmentId":7}',
  },
  {
    name: "padded url strips one www only",
    header: JSON.stringify({
      ...base,
      assignmentId: 7,
      lisOutcomeServiceUrl: "  http://www.www.h.org:8080/p ",
    }),
    body: '{"userId":"a@b.co","role":"learner","assignmentId":7,"lmsHost":"www.h.org"}',
  },
  {
    name: "escaped non-ASCII is decoded",
    header:
      '{"userId":"a@b.co","role":"learner","assignmentId":7,"launch_presentation_locale":"\\u00e9t\\u00e9"}',
    body: '{"userId":"a@b.co","role":"learner","assignmentId":7,"launch_presentation_locale":"été"}',
  },
];

describe("GET /api/v1/user-session", () => {
  it.each(cases)("serves exact bytes: $name", async ({ header, body }) => {
    const { instance } = await app();
    const res = await instance.inject({
      method: "GET",
      url: "/api/v1/user-session",
      headers: { "user-session": header },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(body);
    await instance.close();
  });

  it("omits a non-string returnUrl and logs the field name only", async () => {
    const { instance, lines } = await app();
    const res = await instance.inject({
      method: "GET",
      url: "/api/v1/user-session",
      headers: {
        "user-session": JSON.stringify({
          ...base,
          assignmentId: 7,
          returnUrl: 5,
        }),
      },
    });
    expect(res.body).toBe(
      '{"userId":"a@b.co","role":"learner","assignmentId":7}',
    );
    const logged = lines.filter(
      (l) => l.msg === "session_meta.field_type_unexpected",
    );
    expect(logged).toHaveLength(1);
    expect(logged[0]?.field).toBe("returnUrl");
    expect(JSON.stringify(logged[0])).not.toContain("5,");
    await instance.close();
  });

  it("refuses a request with no session header", async () => {
    const { instance } = await app();
    const res = await instance.inject({
      method: "GET",
      url: "/api/v1/user-session",
    });
    expect(res.statusCode).toBe(401);
    await instance.close();
  });
});

describe("GET /api/v1/ai-status", () => {
  const get = async (flags?: Partial<Config["aiFeatures"]>) => {
    const { instance } = await app(flags);
    const res = await instance.inject({
      method: "GET",
      url: "/api/v1/ai-status",
    });
    await instance.close();
    return res;
  };

  it("is all enabled by default, with no session header", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"grading":true,"chat":true,"authoring":true}');
  });

  it("master kill disables everything", async () => {
    expect((await get({ allDisabled: true })).body).toBe(
      '{"grading":false,"chat":false,"authoring":false}',
    );
  });

  it("a single flag disables only its component", async () => {
    expect((await get({ chatDisabled: true })).body).toBe(
      '{"grading":true,"chat":false,"authoring":true}',
    );
  });
});
