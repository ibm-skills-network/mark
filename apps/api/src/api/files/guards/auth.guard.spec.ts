import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { UserRole } from "src/auth/interfaces/user.session.interface";
import { PrismaService } from "src/database/prisma.service";
import { AuthGuard } from "./auth.guard";

const ASSIGNMENT_ID = 42;

function makeContext(overrides: {
  paramId?: string;
  userSession?: Partial<{
    userId: string;
    role: UserRole;
    assignmentId: number;
    groupId: string;
  }> | null;
}): ExecutionContext {
  const request = {
    params: { id: overrides.paramId },
    userSession: overrides.userSession ?? undefined,
    method: "POST",
    originalUrl: "/files/upload",
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeLogger() {
  const child = {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  return {
    child: jest.fn().mockReturnValue(child),
  } as unknown as Parameters<typeof AuthGuard.prototype.constructor>[1];
}

describe("FilesAuthGuard", () => {
  let prisma: {
    assignment: { findUnique: jest.Mock };
    assignmentAuthor: { findUnique: jest.Mock };
    assignmentGroup: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let guard: AuthGuard;

  beforeEach(() => {
    prisma = {
      assignment: { findUnique: jest.fn() },
      assignmentAuthor: { findUnique: jest.fn() },
      assignmentGroup: { findFirst: jest.fn() },
      $transaction: jest.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    };
    guard = new AuthGuard(
      prisma as unknown as PrismaService,
      makeLogger() as any,
    );
  });

  describe("admin bypass", () => {
    it("allows admins for any existing assignment, even without groupId", async () => {
      prisma.assignment.findUnique.mockResolvedValue({ id: ASSIGNMENT_ID });
      const ctx = makeContext({
        userSession: {
          userId: "admin@example.com",
          role: UserRole.ADMIN,
          assignmentId: ASSIGNMENT_ID,
        },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(prisma.assignmentAuthor.findUnique).not.toHaveBeenCalled();
      expect(prisma.assignmentGroup.findFirst).not.toHaveBeenCalled();
    });

    it("still rejects admins if the assignment does not exist", async () => {
      prisma.assignment.findUnique.mockResolvedValue(null);
      const ctx = makeContext({
        userSession: {
          userId: "admin@example.com",
          role: UserRole.ADMIN,
          assignmentId: ASSIGNMENT_ID,
        },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("author access", () => {
    it("allows the author when they are linked via AssignmentAuthor", async () => {
      prisma.assignment.findUnique.mockResolvedValue({ id: ASSIGNMENT_ID });
      prisma.assignmentAuthor.findUnique.mockResolvedValue({
        assignmentId: ASSIGNMENT_ID,
        userId: "author@example.com",
      });
      const ctx = makeContext({
        userSession: {
          userId: "author@example.com",
          role: UserRole.AUTHOR,
          assignmentId: ASSIGNMENT_ID,
          groupId: "author-group",
        },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(prisma.assignmentAuthor.findUnique).toHaveBeenCalledWith({
        where: {
          assignmentId_userId: {
            assignmentId: ASSIGNMENT_ID,
            userId: "author@example.com",
          },
        },
      });
      expect(prisma.assignmentGroup.findFirst).not.toHaveBeenCalled();
    });

    it("rejects an author who is not linked to the assignment", async () => {
      prisma.assignment.findUnique.mockResolvedValue({ id: ASSIGNMENT_ID });
      prisma.assignmentAuthor.findUnique.mockResolvedValue(null);
      const ctx = makeContext({
        userSession: {
          userId: "stranger@example.com",
          role: UserRole.AUTHOR,
          assignmentId: ASSIGNMENT_ID,
          groupId: "some-group",
        },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("rejects an author session missing userId without hitting Prisma", async () => {
      prisma.assignment.findUnique.mockResolvedValue({ id: ASSIGNMENT_ID });
      const ctx = makeContext({
        userSession: {
          role: UserRole.AUTHOR,
          assignmentId: ASSIGNMENT_ID,
        },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.assignmentAuthor.findUnique).not.toHaveBeenCalled();
    });

    it("allows an author with no groupId (preview mode launched outside a group context)", async () => {
      prisma.assignment.findUnique.mockResolvedValue({ id: ASSIGNMENT_ID });
      prisma.assignmentAuthor.findUnique.mockResolvedValue({
        assignmentId: ASSIGNMENT_ID,
        userId: "author@example.com",
      });
      const ctx = makeContext({
        userSession: {
          userId: "author@example.com",
          role: UserRole.AUTHOR,
          assignmentId: ASSIGNMENT_ID,
        },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe("learner access", () => {
    it("allows a learner with a matching AssignmentGroup link", async () => {
      prisma.assignment.findUnique.mockResolvedValue({ id: ASSIGNMENT_ID });
      prisma.assignmentGroup.findFirst.mockResolvedValue({
        assignmentId: ASSIGNMENT_ID,
      });
      const ctx = makeContext({
        userSession: {
          userId: "learner@example.com",
          role: UserRole.LEARNER,
          assignmentId: ASSIGNMENT_ID,
          groupId: "group-1",
        },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it("rejects a learner with no AssignmentGroup link", async () => {
      prisma.assignment.findUnique.mockResolvedValue({ id: ASSIGNMENT_ID });
      prisma.assignmentGroup.findFirst.mockResolvedValue(null);
      const ctx = makeContext({
        userSession: {
          userId: "learner@example.com",
          role: UserRole.LEARNER,
          assignmentId: ASSIGNMENT_ID,
          groupId: "group-1",
        },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("rejects a learner missing groupId", async () => {
      prisma.assignment.findUnique.mockResolvedValue({ id: ASSIGNMENT_ID });
      const ctx = makeContext({
        userSession: {
          userId: "learner@example.com",
          role: UserRole.LEARNER,
          assignmentId: ASSIGNMENT_ID,
        },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("rejects a learner with a valid groupId when the assignment does not exist", async () => {
      prisma.assignment.findUnique.mockResolvedValue(null);
      prisma.assignmentGroup.findFirst.mockResolvedValue(null);
      const ctx = makeContext({
        userSession: {
          userId: "learner@example.com",
          role: UserRole.LEARNER,
          assignmentId: ASSIGNMENT_ID,
          groupId: "group-1",
        },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("unknown role", () => {
    it("rejects a session whose role is not admin, author, or learner", async () => {
      const ctx = makeContext({
        userSession: {
          userId: "mystery@example.com",
          role: "unknown" as unknown as UserRole,
          assignmentId: ASSIGNMENT_ID,
          groupId: "group-1",
        },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.assignment.findUnique).not.toHaveBeenCalled();
      expect(prisma.assignmentAuthor.findUnique).not.toHaveBeenCalled();
      expect(prisma.assignmentGroup.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("preconditions", () => {
    it("rejects when assignmentId is unresolvable", async () => {
      const ctx = makeContext({
        userSession: { userId: "x", role: UserRole.LEARNER },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("rejects when userSession is missing", async () => {
      const ctx = makeContext({
        paramId: String(ASSIGNMENT_ID),
        userSession: null,
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
