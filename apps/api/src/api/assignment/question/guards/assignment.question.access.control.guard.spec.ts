import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Test, type TestingModule } from "@nestjs/testing";

import {
  UserRole,
  type UserSession,
  type UserSessionRequest,
} from "../../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../../database/prisma.service";
import { AssignmentQuestionAccessControlGuard } from "./assignment.question.access.control.guard";

const mockLogger = {
  child: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
};

const buildSession = (): UserSession => ({
  userId: "user-1",
  role: UserRole.AUTHOR,
  assignmentId: 123,
  groupId: "group-1",
});

const buildContext = (
  params: Record<string, string | undefined>,
): ExecutionContext => {
  const request: Partial<UserSessionRequest> = {
    userSession: buildSession(),
    params: params as UserSessionRequest["params"],
    method: "GET",
    originalUrl: "/api/v1/assignments//question/1",
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request as UserSessionRequest,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
};

describe("AssignmentQuestionAccessControlGuard — hostile input", () => {
  let guard: AssignmentQuestionAccessControlGuard;
  let prisma: {
    $transaction: jest.Mock;
    assignment: { findUnique: jest.Mock };
    assignmentGroup: { findFirst: jest.Mock };
    question: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(),
      assignment: { findUnique: jest.fn() },
      assignmentGroup: { findFirst: jest.fn() },
      question: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentQuestionAccessControlGuard,
        Reflector,
        { provide: PrismaService, useValue: prisma },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    }).compile();

    guard = module.get(AssignmentQuestionAccessControlGuard);
  });

  it("rejects missing :assignmentId with ForbiddenException BEFORE touching Prisma", async () => {
    const context = buildContext({ id: "7" }); // no assignmentId at all

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.assignment.findUnique).not.toHaveBeenCalled();
  });

  it("rejects non-numeric :assignmentId with ForbiddenException BEFORE touching Prisma", async () => {
    const context = buildContext({ assignmentId: "not-a-number", id: "7" });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.assignment.findUnique).not.toHaveBeenCalled();
  });

  it("never passes NaN into prisma.assignment.findUnique", async () => {
    // Arrange Prisma to succeed so we can verify what was passed
    prisma.$transaction.mockResolvedValue([
      { id: 1 },
      { assignmentId: 1, groupId: "group-1" },
      null,
    ]);

    const context = buildContext({ assignmentId: undefined, id: "7" });

    // Either throws (preferred) or short-circuits, but if it does call Prisma,
    // the id must not be NaN.
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
    ["leading plus", "+1"],
    ["leading zero", "01"],
    ["zero", "0"],
    ["negative", "-1"],
  ])("rejects non-canonical assignmentId (%s: %j)", (_label, raw) => {
    it("throws ForbiddenException without touching Prisma", async () => {
      const context = buildContext({ assignmentId: raw, id: "7" });
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
    ["zero", "0"],
    ["negative", "-7"],
  ])("rejects non-canonical questionId (%s: %j)", (_label, raw) => {
    it("throws ForbiddenException without touching Prisma", async () => {
      const context = buildContext({ assignmentId: "1", id: raw });
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
