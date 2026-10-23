import { Test, TestingModule } from "@nestjs/testing";
import { UnprocessableEntityException } from "@nestjs/common";
import { AttemptValidationService } from "./attempt-validation.service";
import { PrismaService } from "../../../database/prisma.service";
import { GradingKillSwitchService } from "../../ai-feature-flags/grading-kill-switch.service";
import { UserSession } from "../../../auth/interfaces/user.session.interface";
import { UserRole } from "../../../auth/interfaces/user.session.interface";

describe("AttemptValidationService - validateNewAttempt error codes", () => {
  let service: AttemptValidationService;

  const mockPrisma = {
    assignmentAttempt: {
      findFirst: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockGradingKillSwitch = {
    assertGradingAllowed: jest.fn(),
  };

  const userSession: UserSession = {
    userId: "user-1",
    role: UserRole.LEARNER,
    assignmentId: 123,
    groupId: "group-1",
  };

  const baseAssignment = {
    id: 123,
    attemptsPerTimeRange: null,
    attemptsTimeRangeHours: null,
    numAttempts: -1,
    attemptsBeforeCoolDown: null,
    retakeAttemptCoolDownMinutes: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttemptValidationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GradingKillSwitchService, useValue: mockGradingKillSwitch },
      ],
    }).compile();

    service = module.get<AttemptValidationService>(AttemptValidationService);
    jest.clearAllMocks();
    mockGradingKillSwitch.assertGradingAllowed.mockResolvedValue(undefined);
    mockPrisma.assignmentAttempt.findFirst.mockResolvedValue(null);
    mockPrisma.assignmentAttempt.count.mockResolvedValue(0);
  });

  const expectUnprocessableWithCode = async (
    promise: Promise<unknown>,
    code: string,
  ) => {
    try {
      await promise;
      throw new Error("expected validateNewAttempt to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      const response = (error as UnprocessableEntityException).getResponse();
      expect(response).toMatchObject({ statusCode: 422, code });
    }
  };

  it("tags the attempt-in-progress 422 with code ATTEMPT_IN_PROGRESS", async () => {
    mockPrisma.assignmentAttempt.findFirst.mockResolvedValue({
      id: 42,
      submitted: false,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expectUnprocessableWithCode(
      service.validateNewAttempt(baseAssignment as never, userSession),
      "ATTEMPT_IN_PROGRESS",
    );
  });

  it("tags the time-range 422 with code ATTEMPT_TIME_RANGE_EXCEEDED", async () => {
    mockPrisma.assignmentAttempt.count.mockResolvedValue(2);

    await expectUnprocessableWithCode(
      service.validateNewAttempt(
        {
          ...baseAssignment,
          attemptsPerTimeRange: 2,
          attemptsTimeRangeHours: 24,
        } as never,
        userSession,
      ),
      "ATTEMPT_TIME_RANGE_EXCEEDED",
    );
  });

  it("tags the max-attempts 422 with code ATTEMPT_MAX_REACHED", async () => {
    mockPrisma.assignmentAttempt.count.mockResolvedValue(3);

    await expectUnprocessableWithCode(
      service.validateNewAttempt(
        { ...baseAssignment, numAttempts: 3 } as never,
        userSession,
      ),
      "ATTEMPT_MAX_REACHED",
    );
  });
});

describe("AttemptValidationService - submission deadline", () => {
  const service = new AttemptValidationService({} as never, {} as never);
  const expiresAt = new Date("2026-10-21T01:16:03.499Z");

  it("does not expire an attempt whose submit arrived 11.7s after the deadline", () => {
    const receivedAt = new Date("2026-10-21T01:16:15.160Z");
    expect(service.isAttemptExpired(expiresAt, receivedAt)).toBe(false);
  });

  it("expires an attempt whose submit arrived after the grace window", () => {
    const receivedAt = new Date(expiresAt.getTime() + 30_001);
    expect(service.isAttemptExpired(expiresAt, receivedAt)).toBe(true);
  });

  it("judges against the time the submit was received, not the time it is checked", () => {
    // A grading job that sat in the queue must not turn an on-time submit
    // into a late one.
    const receivedAt = new Date(expiresAt.getTime() + 5000);
    jest.useFakeTimers().setSystemTime(expiresAt.getTime() + 10 * 60_000);
    try {
      expect(service.isAttemptExpired(expiresAt, receivedAt)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("uses the same window for checkSubmissionDeadline", () => {
    jest.useFakeTimers().setSystemTime(expiresAt.getTime() + 20_000);
    try {
      expect(() => service.checkSubmissionDeadline(expiresAt)).not.toThrow();
      expect(service.isAttemptExpired(expiresAt)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
