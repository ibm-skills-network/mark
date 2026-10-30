import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { AdminVerificationService } from "../../src/auth/services/admin-verification.service";
import { PrismaService } from "../../src/database/prisma.service";
import { GradingV3AdminModule } from "../../src/v3/grading/grading.module";
import { GradingModeService } from "../../src/v3/grading/mode";
import { createV3TestApp, type V3TestApp } from "./helpers/v3-test-app";

// Contract: GET/PUT /api/v3/grading-settings/engine read and flip the global
// fallback between v3 and legacy. All four v3 question types move together;
// assignment settings and effort are untouched. Admin only; the body is
// validated strictly; every write is logged with before and after and clears
// the mode cache. Runs against a real migrated database.
const databaseUrl = process.env.DATABASE_URL_TEST;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const AUTHOR = "author-token-0123456789";
function sessionFor(token: string) {
  const admin = /^admin-(\d+)-token$/.exec(token);
  if (admin) return { email: `admin${admin[1]}@example.com`, role: "admin" };
  if (token === AUTHOR) return { email: "author@example.com", role: "author" };
  return null;
}

const URL_PATH = "/api/v3/grading-settings/engine";
const TYPES = ["TEXT", "UPLOAD", "LINK_FILE", "URL"] as const;

describeWithDatabase("v3 grading engine switch", () => {
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
      data: { name: "v3 engine spec", type: "AI_GRADED", published: false },
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
  const read = () => http().get(URL_PATH).set("x-admin-token", ADMIN);
  const put = (body: unknown) =>
    http()
      .put(URL_PATH)
      .set("x-admin-token", ADMIN)
      .set("x-request-id", "rid-engine")
      .send(body as object);
  const seed = (questionType: (typeof TYPES)[number], mode: string) =>
    prisma.gradingModeConfig.create({
      data: { questionType, mode, updatedBy: "seed@example.com" },
    });
  const globalModes = async () =>
    Object.fromEntries(
      (
        await prisma.gradingModeConfig.findMany({
          where: { assignmentId: null },
        })
      ).map((row) => [row.questionType, row.mode]),
    );

  it("reads as legacy before anything is saved", async () => {
    const res = await read();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      engine: "legacy",
      assignmentOverrides: 0,
      updatedBy: null,
      updatedAt: null,
    });
  });

  it("moves all four question types to v3, creating missing rows", async () => {
    await seed("TEXT", "off");
    const res = await put({ engine: "v3" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ engine: "v3", updatedBy: adminEmail });
    expect(await globalModes()).toEqual({
      TEXT: "live",
      UPLOAD: "live",
      LINK_FILE: "live",
      URL: "live",
    });
    expect(invalidations).toBe(1);
  });

  it("moves all four back to legacy and keeps each type's effort", async () => {
    await Promise.all(TYPES.map((type) => seed(type, "live")));
    await prisma.gradingModeConfig.updateMany({
      where: { questionType: "URL" },
      data: { effort: "high" },
    });
    const res = await put({ engine: "legacy" });
    expect(res.body).toMatchObject({ engine: "legacy" });
    expect(await globalModes()).toEqual({
      TEXT: "off",
      UPLOAD: "off",
      LINK_FILE: "off",
      URL: "off",
    });
    const url = await prisma.gradingModeConfig.findFirst({
      where: { questionType: "URL", assignmentId: null },
    });
    expect(url?.effort).toBe("high");
  });

  it.each([
    ["one type on legacy", ["live", "live", "live", "off"]],
    ["one type in shadow", ["off", "off", "off", "shadow"]],
  ])(
    "reads as mixed with %s, and a switch evens it out",
    async (_name, modes) => {
      await Promise.all(TYPES.map((type, index) => seed(type, modes[index])));
      expect((await read()).body.engine).toBe("mixed");
      expect((await put({ engine: "v3" })).body.engine).toBe("v3");
    },
  );

  it("leaves assignment settings alone and counts them", async () => {
    await prisma.gradingModeConfig.createMany({
      data: [
        { questionType: "TEXT", assignmentId, mode: "live", updatedBy: "x" },
        { questionType: "URL", assignmentId, mode: "live", updatedBy: "x" },
      ],
    });
    const res = await put({ engine: "legacy" });
    expect(res.body.assignmentOverrides).toBe(1);
    const rows = await prisma.gradingModeConfig.findMany({
      where: { assignmentId },
    });
    expect(rows.map((row) => row.mode)).toEqual(["live", "live"]);
  });

  it("logs the write with before and after", async () => {
    await Promise.all(TYPES.map((type) => seed(type, "live")));
    await put({ engine: "legacy" });
    expect(t.logs.filter((l) => l.event === "grading.engine.updated")).toEqual([
      expect.objectContaining({
        user_id: adminEmail,
        request_id: "rid-engine",
        before: {
          TEXT: "live",
          UPLOAD: "live",
          LINK_FILE: "live",
          URL: "live",
        },
        after: { TEXT: "off", UPLOAD: "off", LINK_FILE: "off", URL: "off" },
      }),
    ]);
  });

  it.each([
    [{}],
    [{ engine: "mixed" }],
    [{ engine: "live" }],
    [{ engine: "v3", updatedBy: "someone@example.com" }],
  ])("refuses %p with a generic 400 and writes nothing", async (body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid request",
      requestId: "rid-engine",
    });
    expect(await prisma.gradingModeConfig.count()).toBe(0);
    expect(invalidations).toBe(0);
  });

  it("limits each admin to 10 writes a minute", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      statuses.push((await put({ engine: "v3" })).status);
    }
    expect(statuses).toEqual(Array.from({ length: 10 }, () => 200));
    expect((await put({ engine: "v3" })).status).toBe(429);
  });

  it.each([
    ["no admin token", undefined, 401],
    ["an author session", AUTHOR, 403],
  ])("refuses %s on read and write", async (_name, token, status) => {
    const reading = http().get(URL_PATH);
    const writing = http().put(URL_PATH).send({ engine: "legacy" });
    if (token) {
      reading.set("x-admin-token", token);
      writing.set("x-admin-token", token);
    }
    expect((await reading).status).toBe(status);
    expect((await writing).status).toBe(status);
    expect(await prisma.gradingModeConfig.count()).toBe(0);
  });
});
