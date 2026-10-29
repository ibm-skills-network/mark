import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { AdminVerificationService } from "../../src/auth/services/admin-verification.service";
import { PrismaService } from "../../src/database/prisma.service";
import { GradingV3AdminModule } from "../../src/v3/grading/grading.module";
import { GradingModeService } from "../../src/v3/grading/mode";
import { createV3TestApp, type V3TestApp } from "./helpers/v3-test-app";

// Contract: GET/PUT /api/v3/admin/grading-modes read and upsert the v3
// grading switches. Admin only; the body is validated strictly; an unknown
// assignment is refused; every write is logged with before and after and
// clears the mode cache. Runs against a real migrated database.
const databaseUrl = process.env.DATABASE_URL_TEST;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

// Each test signs in as a different admin, so the per-admin rate limit of
// one test does not carry into the next.
const AUTHOR = "author-token-0123456789";
function sessionFor(token: string) {
  const admin = /^admin-(\d+)-token$/.exec(token);
  if (admin) return { email: `admin${admin[1]}@example.com`, role: "admin" };
  if (token === AUTHOR) return { email: "author@example.com", role: "author" };
  return null;
}

describeWithDatabase("v3 grading modes admin endpoint", () => {
  let t: V3TestApp;
  let prisma: PrismaClient;
  let assignmentId: number;
  let invalidations = 0;
  let adminNumber = 0;
  let ADMIN = "";
  let adminEmail = "";

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    const assignment = await prisma.assignment.create({
      data: { name: "v3 grading modes spec", type: "AI_GRADED", published: false },
      select: { id: true },
    });
    assignmentId = assignment.id;
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
          provide: GradingModeService,
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
    await prisma.gradingModeConfig.deleteMany({});
    await prisma.assignment.delete({ where: { id: assignmentId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.gradingModeConfig.deleteMany({});
    t.logs.length = 0;
    invalidations = 0;
    adminNumber += 1;
    ADMIN = `admin-${adminNumber}-token`;
    adminEmail = `admin${adminNumber}@example.com`;
  });

  const http = () => request(t.app.getHttpServer());
  const put = (body: unknown, token?: string) =>
    http()
      .put("/api/v3/admin/grading-modes")
      .set("x-admin-token", token ?? ADMIN)
      .set("x-request-id", "rid-modes")
      .send(body as object);

  it("creates a global switch, then updates it in place", async () => {
    const created = await put({
      questionType: "TEXT",
      assignmentId: null,
      mode: "shadow",
      effort: null,
    });
    expect(created.status).toBe(200);
    expect(created.body).toEqual({
      id: expect.any(Number),
      questionType: "TEXT",
      assignmentId: null,
      mode: "shadow",
      effort: null,
      updatedBy: adminEmail,
      updatedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    });

    const updated = await put({
      questionType: "TEXT",
      assignmentId: null,
      mode: "live",
      effort: "low",
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      id: created.body.id,
      mode: "live",
      effort: "low",
    });
    expect(await prisma.gradingModeConfig.count()).toBe(1);
    expect(invalidations).toBe(2);
  });

  it("logs each write with before and after", async () => {
    await put({ questionType: "URL", assignmentId, mode: "live", effort: null });
    await put({ questionType: "URL", assignmentId, mode: "off", effort: null });
    const updates = t.logs.filter((l) => l.event === "grading.modes.updated");
    expect(updates).toEqual([
      expect.objectContaining({
        user_id: adminEmail,
        request_id: "rid-modes",
        question_type: "URL",
        target_assignment_id: assignmentId,
        before: null,
        after: expect.objectContaining({ mode: "live", effort: null }),
      }),
      expect.objectContaining({
        before: expect.objectContaining({ mode: "live" }),
        after: expect.objectContaining({ mode: "off" }),
      }),
    ]);
  });

  it("lists every switch with the shadow setting", async () => {
    await put({ questionType: "UPLOAD", assignmentId, mode: "live", effort: "medium" });
    await put({ questionType: "TEXT", assignmentId: null, mode: "off", effort: null });
    const res = await http()
      .get("/api/v3/admin/grading-modes")
      .set("x-admin-token", ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      rows: [
        expect.objectContaining({ questionType: "TEXT", assignmentId: null }),
        expect.objectContaining({ questionType: "UPLOAD", assignmentId }),
      ],
      shadowAllowed: process.env.GRADING_SHADOW_ALLOWED === "true",
    });
  });

  it.each([
    [{}],
    [{ questionType: "TRUE_FALSE", assignmentId: null, mode: "live", effort: null }],
    [{ questionType: "TEXT", assignmentId: -1, mode: "live", effort: null }],
    [{ questionType: "TEXT", assignmentId: 1.5, mode: "live", effort: null }],
    [{ questionType: "TEXT", assignmentId: 2_147_483_648, mode: "live", effort: null }],
    [{ questionType: "TEXT", assignmentId: null, mode: "on", effort: null }],
    [{ questionType: "TEXT", assignmentId: null, mode: "live", effort: "max" }],
    [{ questionType: "TEXT", assignmentId: null, mode: "live" }],
    [
      {
        questionType: "TEXT",
        assignmentId: null,
        mode: "live",
        effort: null,
        isAdmin: true,
      },
    ],
  ])("refuses %p with a generic 400 and writes nothing", async (body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid request",
      requestId: "rid-modes",
    });
    expect(await prisma.gradingModeConfig.count()).toBe(0);
    expect(invalidations).toBe(0);
  });

  it("refuses an assignment that does not exist", async () => {
    const res = await put({
      questionType: "TEXT",
      assignmentId: 2_147_483_000,
      mode: "live",
      effort: null,
    });
    expect(res.status).toBe(400);
    expect(t.logs.filter((l) => l.event === "v3.request.rejected")).toEqual([
      expect.objectContaining({ reason: "unknown_assignment" }),
    ]);
    expect(await prisma.gradingModeConfig.count()).toBe(0);
  });

  it("limits each admin to 10 writes a minute with a 429 envelope", async () => {
    const body = { questionType: "TEXT", assignmentId: null, mode: "off", effort: null };
    const statuses: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      statuses.push((await put(body)).status);
    }
    const limited = await put(body);
    expect(statuses).toEqual(Array.from({ length: 10 }, () => 200));
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests",
      requestId: "rid-modes",
    });
    // Another admin is not held back by the first one's writes.
    adminNumber += 1;
    expect((await put(body, `admin-${adminNumber}-token`)).status).toBe(200);
  });

  it("lets only one of two racing first writes create the switch", async () => {
    const body = { questionType: "UPLOAD", assignmentId: null, mode: "live", effort: null };
    const results = await Promise.all([put(body), put(body), put(body)]);
    for (const res of results) expect([200, 409]).toContain(res.status);
    expect(results.filter((res) => res.status === 200).length).toBeGreaterThan(0);
    expect(await prisma.gradingModeConfig.count()).toBe(1);
  });

  it.each([
    ["no admin token", undefined, 401],
    ["an author session", AUTHOR, 403],
  ])("refuses %s on read and write", async (_name, token, status) => {
    const body = { questionType: "TEXT", assignmentId: null, mode: "live", effort: null };
    const read = http().get("/api/v3/admin/grading-modes");
    const write = http().put("/api/v3/admin/grading-modes").send(body);
    if (token) {
      read.set("x-admin-token", token);
      write.set("x-admin-token", token);
    }
    expect((await read).status).toBe(status);
    expect((await write).status).toBe(status);
    expect(await prisma.gradingModeConfig.count()).toBe(0);
  });
});
