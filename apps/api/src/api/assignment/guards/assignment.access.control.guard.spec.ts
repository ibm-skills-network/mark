import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Prisma } from "@prisma/client";

import {
  UserRole,
  type UserSession,
  type UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../database/prisma.service";
import { AssignmentControllerV2 } from "../v2/controllers/assignment.controller";
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
    handler: (...arguments_: never[]) => unknown = () => undefined,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => AssignmentControllerV2,
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
    }) as unknown as ExecutionContext;

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
    (mockPrisma.assignment.findUnique as jest.Mock).mockResolvedValue({
      id: 4535,
    });

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

  it("denies an author targeting another quiz even when both share a group", async () => {
    mockPrisma.$transaction = jest
      .fn()
      .mockResolvedValue([
        { assignmentId: 42, groupId: "shared-group" },
        { id: 42 },
      ]);
    await expect(
      guard.canActivate(
        createContext(
          { role: UserRole.AUTHOR, assignmentId: 4535 },
          { id: "42" },
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows a collaborator with an author launch for this quiz", async () => {
    mockNoLink();
    (mockPrisma.assignmentGroup.create as jest.Mock).mockResolvedValue({});
    await expect(
      guard.canActivate(
        createContext(
          { role: UserRole.AUTHOR, userId: "collaborator" },
          { id: "4535" },
        ),
      ),
    ).resolves.toBe(true);
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
  describe("route id parsing", () => {
    it.each(["0", "-1", "2147483648", "99999999999999999999"])(
      "answers 404 for %s without querying or using the session id",
      async (raw) => {
        mockPrisma.$transaction = jest.fn();
        (mockPrisma.assignment.findUnique as jest.Mock).mockReset();
        await expect(
          guard.canActivate(createContext({}, { id: raw })),
        ).rejects.toMatchObject({
          constructor: NotFoundException,
          message: "Assignment not found",
        });
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
        expect(mockPrisma.assignment.findUnique).not.toHaveBeenCalled();
      },
    );

    it.each(["12abc", "abc", "1.5", "1e3", ""])(
      "answers 400 like ParseIntPipe for %p",
      async (raw) => {
        mockPrisma.$transaction = jest.fn();
        await expect(
          guard.canActivate(createContext({}, { id: raw })),
        ).rejects.toMatchObject({
          constructor: BadRequestException,
          message: "Validation failed (numeric string is expected)",
        });
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it("accepts the int32 maximum", async () => {
      mockPrisma.$transaction = jest
        .fn()
        .mockResolvedValue([{ assignmentId: 2_147_483_647 }, { id: 1 }]);
      await expect(
        guard.canActivate(createContext({}, { id: "2147483647" })),
      ).resolves.toBe(true);
    });
  });

  describe("absent group id", () => {
    it.each([undefined, ""])(
      "never queries the group link for groupId %p and denies access",
      async (groupId) => {
        mockPrisma.$transaction = jest.fn();
        (mockPrisma.assignment.findUnique as jest.Mock).mockResolvedValue({
          id: 4535,
        });
        await expect(
          guard.canActivate(createContext({ groupId }, { id: "4535" })),
        ).rejects.toMatchObject({
          constructor: ForbiddenException,
          message: "Access denied to this assignment",
        });
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
        expect(mockPrisma.assignmentGroup.findFirst).not.toHaveBeenCalled();
        expect(mockPrisma.assignmentGroup.create).not.toHaveBeenCalled();
      },
    );

    it("still answers 404 for a missing assignment", async () => {
      (mockPrisma.assignment.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(
        guard.canActivate(
          createContext({ groupId: undefined }, { id: "4535" }),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("group-link heal per route", () => {
    it("heals on GET assignment", async () => {
      mockNoLink();
      (mockPrisma.assignmentGroup.create as jest.Mock).mockResolvedValue({});
      await expect(
        guard.canActivate(
          createContext(
            {},
            { id: "4535" },
            AssignmentControllerV2.prototype.getAssignment,
          ),
        ),
      ).resolves.toBe(true);
      expect(mockPrisma.assignmentGroup.create).toHaveBeenCalledTimes(1);
    });

    it("never heals on GET languages", async () => {
      mockNoLink();
      await expect(
        guard.canActivate(
          createContext(
            {},
            { id: "4535" },
            AssignmentControllerV2.prototype.getAvailableLanguages,
          ),
        ),
      ).rejects.toMatchObject({
        constructor: ForbiddenException,
        message: "Access denied to this assignment",
      });
      expect(mockPrisma.assignmentGroup.create).not.toHaveBeenCalled();
    });
  });
});
