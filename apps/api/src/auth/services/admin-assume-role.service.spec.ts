import { NotFoundException } from "@nestjs/common";
import { AdminAssumeRoleService } from "./admin-assume-role.service";

const logger = {
  child: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
};

describe("AdminAssumeRoleService", () => {
  let prisma: {
    assignment: { findUnique: jest.Mock };
    assignmentAuthor: { findUnique: jest.Mock; upsert: jest.Mock };
  };
  let service: AdminAssumeRoleService;

  beforeEach(() => {
    prisma = {
      assignment: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 42, groups: [{ groupId: "course-a" }] }),
      },
      assignmentAuthor: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };
    service = new AdminAssumeRoleService(prisma as never, logger as never);
  });

  it("returns learner claims under the admin's own lowercased email", async () => {
    await expect(
      service.assumeRole("Admin@Example.com", 42, "learner"),
    ).resolves.toEqual({
      userId: "admin@example.com",
      role: "learner",
      assignmentId: 42,
      groupId: "course-a",
    });
    expect(prisma.assignmentAuthor.upsert).not.toHaveBeenCalled();
  });

  it("adds the admin to the author list for author sessions", async () => {
    await service.assumeRole("admin@example.com", 42, "author");
    expect(prisma.assignmentAuthor.upsert).toHaveBeenCalledWith({
      where: {
        assignmentId_userId: { assignmentId: 42, userId: "admin@example.com" },
      },
      create: { assignmentId: 42, userId: "admin@example.com" },
      update: {},
    });
  });

  it("does not rewrite an existing author row", async () => {
    prisma.assignmentAuthor.findUnique.mockResolvedValue({ id: 9 });
    await service.assumeRole("admin@example.com", 42, "author");
    expect(prisma.assignmentAuthor.upsert).not.toHaveBeenCalled();
  });

  it("refuses an unknown assignment", async () => {
    prisma.assignment.findUnique.mockResolvedValue(null);
    await expect(
      service.assumeRole("admin@example.com", 42, "author"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.assignmentAuthor.upsert).not.toHaveBeenCalled();
  });

  it("refuses an assignment with no course link instead of inventing one", async () => {
    prisma.assignment.findUnique.mockResolvedValue({ id: 42, groups: [] });
    await expect(
      service.assumeRole("admin@example.com", 42, "learner"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
