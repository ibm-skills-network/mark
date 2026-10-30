import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Logger } from "winston";
import { PrismaService } from "src/database/prisma.service";
import { ChatAccessControlGuard } from "../../../guards/chat.access.control.guard";

describe("ChatAccessControlGuard on POST /chats/today/lookup", () => {
  let guard: ChatAccessControlGuard;
  let findFirst: jest.Mock;

  const session = {
    userId: "learner-1@example.test",
    role: "learner",
    assignmentId: 3670,
    groupId: "group-1",
  };

  const contextFor = (body: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method: "POST",
          originalUrl: "/api/v1/chats/today/lookup",
          path: "/api/v1/chats/today/lookup",
          headers: { "user-session": JSON.stringify(session) },
          params: {},
          body,
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    findFirst = jest.fn();
    const logger = { warn: jest.fn(), child: jest.fn() };
    logger.child.mockReturnValue(logger);
    guard = new ChatAccessControlGuard(
      new Reflector(),
      { assignmentGroup: { findFirst } } as unknown as PrismaService,
      logger as unknown as Logger,
    );
  });

  it("rejects an assignment the learner's group is not linked to", async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        contextFor({ userId: session.userId, assignmentId: 42 }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).toHaveBeenCalledWith({
      where: { assignmentId: 42, groupId: "group-1" },
    });
  });

  it("allows a linked assignment", async () => {
    findFirst.mockResolvedValue({ assignmentId: 3670, groupId: "group-1" });

    await expect(
      guard.canActivate(
        contextFor({ userId: session.userId, assignmentId: 3670 }),
      ),
    ).resolves.toBe(true);
  });

  it("rejects a lookup for another user", async () => {
    await expect(
      guard.canActivate(contextFor({ userId: "someone-else@example.test" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
