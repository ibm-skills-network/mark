import { ExecutionContext, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "../../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../../database/prisma.service";
import { AssignmentAttemptAccessControlGuard } from "./assignment.attempt.access.control.guard";

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
