import { INestApplication, VersioningType } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import request from "supertest";
import { AssignmentAttemptAccessControlGuard } from "../assignment/attempt/guards/assignment.attempt.access.control.guard";
import { UserRole } from "../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../database/prisma.service";
import { GradingKillSwitchService } from "../ai-feature-flags/grading-kill-switch.service";
import { GRADING_AUDIT_SERVICE } from "./attempt.constants";
import { AttemptControllerV2 } from "./attempt.controller";
import { AttemptServiceV2 } from "./services/attempt.service";
import { LtiGradeSyncService } from "./services/lti-grade-sync.service";

const logger = {
  child: () => logger,
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

describe("AttemptControllerV2 learner session without userId", () => {
  let app: INestApplication;
  const attemptService = {
    createAssignmentAttempt: jest.fn(),
    listAssignmentAttempts: jest.fn(),
  };
  const prisma = {
    assignment: { findUnique: jest.fn() },
    assignmentGroup: { findFirst: jest.fn() },
    assignmentAttempt: { findFirst: jest.fn() },
    question: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  let session: Record<string, unknown>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AttemptControllerV2],
      providers: [
        AssignmentAttemptAccessControlGuard,
        { provide: WINSTON_MODULE_PROVIDER, useValue: logger },
        { provide: AttemptServiceV2, useValue: attemptService },
        { provide: GRADING_AUDIT_SERVICE, useValue: {} },
        { provide: "GradingProgressService", useValue: {} },
        { provide: LtiGradeSyncService, useValue: {} },
        { provide: GradingKillSwitchService, useValue: {} },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI });
    app.use(
      (
        request_: { userSession?: unknown },
        _response: unknown,
        next: () => void,
      ) => {
        request_.userSession = session;
        next();
      },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    session = { role: UserRole.LEARNER, groupId: "group-1", assignmentId: 42 };
  });

  it.each([undefined, ""])(
    "refuses POST create for userId %p with Forbidden resource before any query",
    async (userId) => {
      session.userId = userId;
      const response = await request(app.getHttpServer())
        .post("/v2/assignments/42/attempts")
        .expect(403);

      expect(response.body).toEqual({
        message: "Forbidden resource",
        error: "Forbidden",
        statusCode: 403,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(attemptService.createAssignmentAttempt).not.toHaveBeenCalled();
    },
  );

  it("refuses GET list the same way", async () => {
    const response = await request(app.getHttpServer())
      .get("/v2/assignments/42/attempts")
      .expect(403);

    expect(response.body).toEqual({
      message: "Forbidden resource",
      error: "Forbidden",
      statusCode: 403,
    });
    expect(attemptService.listAssignmentAttempts).not.toHaveBeenCalled();
  });
});
