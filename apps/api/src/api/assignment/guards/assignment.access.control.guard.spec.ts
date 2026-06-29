import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AssignmentAccessControlGuard } from "./assignment.access.control.guard";

const makeLogger = () => ({
  child: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
});

describe("AssignmentAccessControlGuard — admin override", () => {
  it("allows any assignment when adminOverride is set, without a group lookup", async () => {
    const prisma = {
      assignmentGroup: { findFirst: jest.fn() },
      assignment: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    const guard = new AssignmentAccessControlGuard(
      {} as never,
      prisma as never,
      makeLogger() as never,
    );
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          userSession: {
            userId: "admin@ibm.com",
            role: "author",
            adminOverride: true,
          },
          params: { id: "4171" },
          method: "GET",
          originalUrl: "/api/v2/assignments/4171",
        }),
      }),
    } as never;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("AssignmentAccessControlGuard — existing denial behavior unchanged", () => {
  it("throws ForbiddenException when user group has no link to the assignment (no override)", async () => {
    const prisma = {
      assignmentGroup: { findFirst: jest.fn() },
      assignment: { findUnique: jest.fn() },
      $transaction: jest
        .fn()
        .mockResolvedValue([null, { id: 4171, title: "Test" }]),
    };
    const guard = new AssignmentAccessControlGuard(
      new Reflector(),
      prisma as never,
      makeLogger() as never,
    );
    const ctx: ExecutionContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          userSession: {
            userId: "learner@ibm.com",
            role: "learner",
            groupId: "group-99",
            assignmentId: 4171,
          },
          params: { id: "4171" },
          method: "GET",
          originalUrl: "/api/v2/assignments/4171",
        }),
        getResponse: () => ({}),
        getNext: () => undefined,
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("throws NotFoundException when the assignment does not exist (no override)", async () => {
    const prisma = {
      assignmentGroup: { findFirst: jest.fn() },
      assignment: { findUnique: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([null, null]),
    };
    const guard = new AssignmentAccessControlGuard(
      new Reflector(),
      prisma as never,
      makeLogger() as never,
    );
    const ctx: ExecutionContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          userSession: {
            userId: "learner@ibm.com",
            role: "learner",
            groupId: "group-99",
            assignmentId: 4171,
          },
          params: { id: "4171" },
          method: "GET",
          originalUrl: "/api/v2/assignments/4171",
        }),
        getResponse: () => ({}),
        getNext: () => undefined,
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
