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

  it("throws NotFoundException (not TypeError) when a learner's attempt pre-check returns null", async () => {
    // The LEARNER-only pre-check previously assumed findUnique always returned
    // a row; if the attemptId doesn't exist it returned null and the guard
    // NPE'd on `userId.userId`.
    prisma.assignmentAttempt.findUnique.mockResolvedValue(null);

    const context = buildContext(
      { assignmentId: "1", attemptId: "999999" },
      UserRole.LEARNER,
    );

    const promise = guard.canActivate(context);

    await expect(promise).rejects.toBeInstanceOf(NotFoundException);
    await expect(promise).rejects.not.toBeInstanceOf(TypeError);
  });
});
