import { HttpService } from "@nestjs/axios";
import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../../database/prisma.service";
import { isPastSubmissionGrace } from "../../assignment/attempt/helper/submission-deadline.helper";
import { EXPIRED_ATTEMPT_COMMENT } from "../../assignment/attempt/helper/submission-deadline.helper";
import { AttemptAccessCacheService } from "./attempt-access-cache.service";
import { AttemptGradingService } from "./attempt-grading.service";
import { AttemptSubmissionService } from "./attempt-submission.service";
import { AttemptValidationService } from "./attempt-validation.service";
import { LtiGradeSyncService } from "./lti-grade-sync.service";
import { QuestionResponseService } from "./question-response/question-response.service";
import { QuestionVariantService } from "./question-variant/question-variant.service";
import { TranslationService } from "./translation/translation.service";

const LEARNER = "learner@example.com";

describe("AttemptSubmissionService.getAttemptSubmissionStatus", () => {
  let service: AttemptSubmissionService;
  const mockPrisma = { assignmentAttempt: { findFirst: jest.fn() } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttemptSubmissionService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: AttemptValidationService,
          useValue: {
            isAttemptExpired: (expiresAt: Date | null, receivedAt?: Date) =>
              isPastSubmissionGrace(expiresAt, receivedAt),
          },
        },
        { provide: AttemptGradingService, useValue: {} },
        { provide: AttemptAccessCacheService, useValue: {} },
        { provide: QuestionResponseService, useValue: {} },
        { provide: TranslationService, useValue: {} },
        { provide: QuestionVariantService, useValue: {} },
        { provide: LtiGradeSyncService, useValue: {} },
        { provide: HttpService, useValue: {} },
      ],
    }).compile();
    service = module.get(AttemptSubmissionService);
    jest.clearAllMocks();
  });

  it("reads only the learner's own attempt on the route assignment", async () => {
    mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
      id: 9,
      submitted: false,
      comments: null,
      expiresAt: null,
    });

    await service.getAttemptSubmissionStatus(9, 771, LEARNER);

    expect(mockPrisma.assignmentAttempt.findFirst).toHaveBeenCalledWith({
      where: { id: 9, assignmentId: 771, userId: LEARNER },
      select: { id: true, submitted: true, comments: true, expiresAt: true },
    });
  });

  it("reports a fresh server clock and whether submits are still accepted", async () => {
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
      id: 9,
      submitted: false,
      comments: null,
      expiresAt,
    });

    const before = Date.now();
    const status = await service.getAttemptSubmissionStatus(9, 771, LEARNER);
    const after = Date.now();

    expect(Object.keys(status).sort()).toEqual(
      [
        "acceptingSubmissions",
        "closedAtTimeLimit",
        "expiresAt",
        "id",
        "serverNow",
        "submitted",
      ].sort(),
    );
    expect(status).toMatchObject({
      id: 9,
      submitted: false,
      closedAtTimeLimit: false,
      acceptingSubmissions: true,
      expiresAt: expiresAt.toISOString(),
    });
    const serverNow = Date.parse(status.serverNow);
    expect(serverNow).toBeGreaterThanOrEqual(before);
    expect(serverNow).toBeLessThanOrEqual(after);
  });

  it("reports an attempt closed at its time limit as not accepting submits", async () => {
    mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
      id: 1_873_208,
      submitted: true,
      comments: EXPIRED_ATTEMPT_COMMENT,
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(
      service.getAttemptSubmissionStatus(1_873_208, 771, LEARNER),
    ).resolves.toMatchObject({
      submitted: true,
      closedAtTimeLimit: true,
      acceptingSubmissions: false,
    });
  });

  it("reports an unsubmitted attempt past its grace window as not accepting submits", async () => {
    mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
      id: 10,
      submitted: false,
      comments: null,
      expiresAt: new Date(Date.now() - 31_000),
    });

    await expect(
      service.getAttemptSubmissionStatus(10, 771, LEARNER),
    ).resolves.toMatchObject({ submitted: false, acceptingSubmissions: false });
  });

  it("404s an attempt that is missing or not the learner's", async () => {
    mockPrisma.assignmentAttempt.findFirst.mockResolvedValue(null);

    await expect(
      service.getAttemptSubmissionStatus(10, 771, LEARNER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("refuses a session without a user id before querying", async () => {
    await expect(
      service.getAttemptSubmissionStatus(10, 771, ""),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockPrisma.assignmentAttempt.findFirst).not.toHaveBeenCalled();
  });
});
