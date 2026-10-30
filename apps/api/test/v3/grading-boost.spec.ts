import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { AdminVerificationService } from "../../src/auth/services/admin-verification.service";
import { PrismaService } from "../../src/database/prisma.service";
import { GradingBoostService } from "../../src/v3/grading/boost";
import { GradingV3AdminModule } from "../../src/v3/grading/grading.module";
import { createV3TestApp, type V3TestApp } from "./helpers/v3-test-app";

// Contract: GET/PUT /api/v3/grading-settings/boost read and save the one
// effort-boost setting. Outside /admin so the admin dashboard reaches it the
// way it reaches the LLM settings; the x-admin-token guard decides access.
// The body is validated strictly; every write is logged with before and
// after and clears the boost cache. Runs against a real migrated database.
const databaseUrl = process.env.DATABASE_URL_TEST;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const AUTHOR = "author-token-0123456789";
function sessionFor(token: string) {
  const admin = /^admin-(\d+)-token$/.exec(token);
  if (admin) return { email: `admin${admin[1]}@example.com`, role: "admin" };
  if (token === AUTHOR) return { email: "author@example.com", role: "author" };
  return null;
}

describeWithDatabase("v3 grading boost setting endpoint", () => {
  let t: V3TestApp;
  let prisma: PrismaClient;
  let invalidations = 0;
  let adminNumber = 0;
  let ADMIN = "";
  let adminEmail = "";

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    t = await createV3TestApp({
      extraV3Modules: [GradingV3AdminModule],
      overrides: [
        { provide: PrismaService, useValue: prisma },
        {
          provide: AdminVerificationService,
          useValue: {
            verifyAdminSession: (token: string) =>
              Promise.resolve(sessionFor(token)),
          },
        },
        {
          provide: GradingBoostService,
          useValue: {
            invalidate: () => {
              invalidations += 1;
            },
          },
        },
      ],
    });
  });

  afterAll(async () => {
    await t.close();
    await prisma.gradingBoostConfig.deleteMany({});
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.gradingBoostConfig.deleteMany({});
    t.logs.length = 0;
    invalidations = 0;
    adminNumber += 1;
    ADMIN = `admin-${adminNumber}-token`;
    adminEmail = `admin${adminNumber}@example.com`;
  });

  const http = () => request(t.app.getHttpServer());
  const put = (body: unknown, token?: string) =>
    http()
      .put("/api/v3/grading-settings/boost")
      .set("x-admin-token", token ?? ADMIN)
      .set("x-request-id", "rid-boost")
      .send(body as object);
  const on = {
    enabled: true,
    pointsPerStep: 4,
    maxBoost: 3,
    minScorePercent: 40,
  };

  it("reads as off with the default steps before anything is saved", async () => {
    const res = await http()
      .get("/api/v3/grading-settings/boost")
      .set("x-admin-token", ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: false,
      pointsPerStep: 4,
      maxBoost: 3,
      minScorePercent: 40,
      updatedBy: null,
      updatedAt: null,
    });
  });

  it("saves the setting, then updates the same row", async () => {
    const created = await put(on);
    expect(created.status).toBe(200);
    expect(created.body).toEqual({
      ...on,
      updatedBy: adminEmail,
      updatedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    });
    const updated = await put({ ...on, maxBoost: 2 });
    expect(updated.body).toMatchObject({ maxBoost: 2 });
    expect(await prisma.gradingBoostConfig.count()).toBe(1);
    expect(invalidations).toBe(2);
    const read = await http()
      .get("/api/v3/grading-settings/boost")
      .set("x-admin-token", ADMIN);
    expect(read.body).toMatchObject({ ...on, maxBoost: 2 });
  });

  it("logs each write with before and after", async () => {
    await put(on);
    await put({ ...on, enabled: false });
    expect(t.logs.filter((l) => l.event === "grading.boost.updated")).toEqual([
      expect.objectContaining({
        user_id: adminEmail,
        request_id: "rid-boost",
        before: null,
        after: on,
      }),
      expect.objectContaining({
        before: on,
        after: { ...on, enabled: false },
      }),
    ]);
  });

  it.each([
    [{}],
    [{ ...on, enabled: "yes" }],
    [{ ...on, pointsPerStep: 0 }],
    [{ ...on, pointsPerStep: 101 }],
    [{ ...on, pointsPerStep: 2.5 }],
    [{ ...on, maxBoost: -1 }],
    [{ ...on, maxBoost: 21 }],
    [{ ...on, minScorePercent: -1 }],
    [{ ...on, minScorePercent: 101 }],
    [{ ...on, minScorePercent: 39.5 }],
    [{ enabled: true, pointsPerStep: 4, maxBoost: 3 }],
    [{ ...on, updatedBy: "someone@example.com" }],
  ])("refuses %p with a generic 400 and writes nothing", async (body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid request",
      requestId: "rid-boost",
    });
    expect(await prisma.gradingBoostConfig.count()).toBe(0);
    expect(invalidations).toBe(0);
  });

  it("limits each admin to 10 writes a minute", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      statuses.push((await put(on)).status);
    }
    expect(statuses).toEqual(Array.from({ length: 10 }, () => 200));
    expect((await put(on)).status).toBe(429);
  });

  it.each([
    ["no admin token", undefined, 401],
    ["an author session", AUTHOR, 403],
  ])("refuses %s on read and write", async (_name, token, status) => {
    const read = http().get("/api/v3/grading-settings/boost");
    const write = http().put("/api/v3/grading-settings/boost").send(on);
    if (token) {
      read.set("x-admin-token", token);
      write.set("x-admin-token", token);
    }
    expect((await read).status).toBe(status);
    expect((await write).status).toBe(status);
    expect(await prisma.gradingBoostConfig.count()).toBe(0);
  });
});
