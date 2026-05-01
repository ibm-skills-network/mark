import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Test, type TestingModule } from "@nestjs/testing";

import {
  UserRole,
  type UserSession,
  type UserSessionRequest,
} from "../../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../../database/prisma.service";
import { AssignmentAttemptAccessControlGuard } from "./assignment.attempt.access.control.guard";

const mockLogger = {
  child: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
};

const buildSession = (role: UserRole = UserRole.AUTHOR): UserSession => ({
  userId: "user-1",
  role,
  assignmentId: 123,
  groupId: "group-1",
});

const buildContext = (
  params: Record<string, string | undefined>,
  role: UserRole = UserRole.AUTHOR,
): ExecutionContext => {
  const request: Partial<UserSessionRequest> = {
    userSession: buildSession(role),
    params: params as UserSessionRequest["params"],
    method: "GET",
    originalUrl: "/api/v1/assignments//attempts/1",
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request as UserSessionRequest,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
};

describe("AssignmentAttemptAccessControlGuard — hostile input", () => {
  let guard: AssignmentAttemptAccessControlGuard;
  let prisma: {
    $transaction: jest.Mock;
    assignment: { findUnique: jest.Mock };
    assignmentGroup: { findFirst: jest.Mock };
    assignmentAttempt: { findUnique: jest.Mock; findFirst: jest.Mock };
    question: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(),
      assignment: { findUnique: jest.fn() },
      assignmentGroup: { findFirst: jest.fn() },
      assignmentAttempt: { findUnique: jest.fn(), findFirst: jest.fn() },
      question: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentAttemptAccessControlGuard,
        Reflector,
        { provide: PrismaService, useValue: prisma },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    }).compile();

    guard = module.get(AssignmentAttemptAccessControlGuard);
  });

  it("rejects missing :assignmentId with ForbiddenException BEFORE touching Prisma", async () => {
    const context = buildContext({ attemptId: "9" });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.assignment.findUnique).not.toHaveBeenCalled();
    expect(prisma.assignmentAttempt.findUnique).not.toHaveBeenCalled();
  });

  it("rejects non-numeric :assignmentId with ForbiddenException BEFORE touching Prisma", async () => {
    const context = buildContext({ assignmentId: "abc", attemptId: "9" });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.assignment.findUnique).not.toHaveBeenCalled();
    expect(prisma.assignmentAttempt.findUnique).not.toHaveBeenCalled();
  });

  it("never passes NaN into prisma.assignment.findUnique", async () => {
    prisma.$transaction.mockResolvedValue([
      { id: 1 },
      { assignmentId: 1, groupId: "group-1" },
      { id: 9, assignmentId: 1 },
    ]);
    prisma.assignmentAttempt.findUnique.mockResolvedValue({ userId: "user-1" });

    const context = buildContext(
      { assignmentId: undefined, attemptId: "9" },
      UserRole.AUTHOR,
    );

    await guard.canActivate(context).catch(() => {
      /* expected */
    });

    const findUniqueCalls = prisma.assignment.findUnique.mock.calls;
    for (const [arg] of findUniqueCalls) {
      expect(Number.isNaN(arg?.where?.id)).toBe(false);
    }
  });

  describe.each([
    ["decimal", "1.5"],
    ["exponent", "1e3"],
    ["hex", "0x1"],
    ["leading whitespace", " 1"],
    ["trailing whitespace", "1 "],
    ["leading plus", "+1"],
    ["leading zero", "01"],
    ["zero", "0"],
    ["negative", "-1"],
    ["dotted zero", "1.0"],
  ])("rejects non-canonical assignmentId (%s: %j)", (_label, raw) => {
    it("throws ForbiddenException without touching Prisma", async () => {
      const context = buildContext({ assignmentId: raw, attemptId: "9" });
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.assignment.findUnique).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ["decimal", "1.5"],
    ["exponent", "1e3"],
    ["hex", "0x1"],
    ["leading whitespace", " 9"],
    ["leading plus", "+9"],
    ["zero", "0"],
    ["negative", "-9"],
  ])("rejects non-canonical attemptId (%s: %j)", (_label, raw) => {
    it("throws ForbiddenException without touching Prisma", async () => {
      const context = buildContext({ assignmentId: "1", attemptId: raw });
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});

describe("AssignmentAttemptAccessControlGuard", () => {
  const mockPrisma = {
    assignment: {
      findUnique: jest.fn(),
    },
    assignmentGroup: {
      findFirst: jest.fn(),
    },
    assignmentAttempt: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    question: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaService;

  const logger = {
    child: jest.fn().mockReturnValue({
      warn: jest.fn(),
    }),
  };

  let guard: AssignmentAttemptAccessControlGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new AssignmentAttemptAccessControlGuard(
      new Reflector(),
      mockPrisma,
      logger as never,
    );
  });

  const createContext = (): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          userSession: {
            userId: "learner-1",
            role: UserRole.LEARNER,
            groupId: "group-1",
          },
          params: {
            assignmentId: "42",
            attemptId: "88",
          },
          method: "GET",
          originalUrl: "/assignments/42/attempts/88",
        }),
      }),
    }) as ExecutionContext;

  it("checks learner-owned attempt access with a single attempt query inside the transaction", async () => {
    mockPrisma.$transaction = jest
      .fn()
      .mockResolvedValue([
        { id: 42 },
        { id: 1, assignmentId: 42, groupId: "group-1" },
        { id: 88, assignmentId: 42, userId: "learner-1" },
        undefined,
      ]);

    await expect(guard.canActivate(createContext())).resolves.toBe(true);

    expect(mockPrisma.assignmentAttempt.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.assignmentAttempt.findFirst).toHaveBeenCalledWith({
      where: {
        id: 88,
        assignmentId: 42,
        userId: "learner-1",
      },
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("throws not found when the learner does not own the attempt", async () => {
    mockPrisma.$transaction = jest
      .fn()
      .mockResolvedValue([
        { id: 42 },
        { id: 1, assignmentId: 42, groupId: "group-1" },
        null,
        undefined,
      ]);

    await expect(guard.canActivate(createContext())).rejects.toThrow(
      NotFoundException,
    );
    expect(mockPrisma.assignmentAttempt.findUnique).not.toHaveBeenCalled();
  });
});
