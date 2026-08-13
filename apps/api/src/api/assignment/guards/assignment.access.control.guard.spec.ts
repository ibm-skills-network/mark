import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Prisma } from "@prisma/client";

import {
  UserRole,
  type UserSession,
  type UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../database/prisma.service";
import { AssignmentAccessControlGuard } from "./assignment.access.control.guard";

describe("AssignmentAccessControlGuard — launch-derived auto-link", () => {
  const mockPrisma = {
    assignment: {
      findUnique: jest.fn(),
    },
    assignmentGroup: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaService;

  const childLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const logger = {
    child: jest.fn().mockReturnValue(childLogger),
  };

  let guard: AssignmentAccessControlGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    logger.child.mockReturnValue(childLogger);
    guard = new AssignmentAccessControlGuard(
      new Reflector(),
      mockPrisma,
      logger as never,
    );
  });

  const createContext = (
    session: Partial<UserSession>,
    params: Record<string, string | undefined> = {},
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          userSession: {
            userId: "learner-1",
            role: UserRole.LEARNER,
            assignmentId: 4535,
            groupId: "autogen-faculty-v1-course-v1-Org-Course-v1",
            ...session,
          },
          params: params as UserSessionRequest["params"],
          method: "GET",
          originalUrl: "/api/v1/assignments/4535",
        }),
      }),
    }) as ExecutionContext;

  const mockNoLink = (assignment: { id: number } | null = { id: 4535 }) => {
    mockPrisma.$transaction = jest.fn().mockResolvedValue([null, assignment]);
  };

  it("creates the missing group link and allows access when the signed session targets this assignment", async () => {
    mockNoLink();
    (mockPrisma.assignmentGroup.create as jest.Mock).mockResolvedValue({
      assignmentId: 4535,
      groupId: "autogen-faculty-v1-course-v1-Org-Course-v1",
    });

    const context = createContext({}, { id: "4535" });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(mockPrisma.assignmentGroup.create).toHaveBeenCalledWith({
      data: {
        assignment: { connect: { id: 4535 } },
        group: {
          connectOrCreate: {
            where: { id: "autogen-faculty-v1-course-v1-Org-Course-v1" },
            create: { id: "autogen-faculty-v1-course-v1-Org-Course-v1" },
          },
        },
      },
    });
  });

  it("still denies access when the session was minted for a different assignment", async () => {
    mockNoLink({ id: 42 });

    const context = createContext({ assignmentId: 4535 }, { id: "42" });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(mockPrisma.assignmentGroup.create).not.toHaveBeenCalled();
  });

  it("does not auto-link when the session has no group id", async () => {
    mockNoLink();

    const context = createContext({ groupId: "" }, { id: "4535" });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(mockPrisma.assignmentGroup.create).not.toHaveBeenCalled();
  });

  it("allows access when a concurrent launch already created the link", async () => {
    mockNoLink();
    (mockPrisma.assignmentGroup.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique conflict", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    const context = createContext({}, { id: "4535" });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("rethrows unexpected link-creation failures after logging", async () => {
    mockNoLink();
    const databaseError = new Error("connection lost");
    (mockPrisma.assignmentGroup.create as jest.Mock).mockRejectedValue(
      databaseError,
    );

    const context = createContext({}, { id: "4535" });

    await expect(guard.canActivate(context)).rejects.toBe(databaseError);
    expect(childLogger.error).toHaveBeenCalled();
  });

  it("keeps allowing access through an existing group link without writing", async () => {
    mockPrisma.$transaction = jest.fn().mockResolvedValue([
      {
        assignmentId: 4535,
        groupId: "autogen-faculty-v1-course-v1-Org-Course-v1",
      },
      { id: 4535 },
    ]);

    const context = createContext({}, { id: "4535" });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(mockPrisma.assignmentGroup.create).not.toHaveBeenCalled();
  });
});
