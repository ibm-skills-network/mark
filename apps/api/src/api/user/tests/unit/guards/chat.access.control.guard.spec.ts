import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Logger } from "winston";
import { PrismaService } from "src/database/prisma.service";
import { ChatAccessControlGuard } from "../../../guards/chat.access.control.guard";

describe("ChatAccessControlGuard", () => {
  let guard: ChatAccessControlGuard;
  let findFirst: jest.Mock;
  let findUnique: jest.Mock;

  const session = {
    userId: "learner-1@example.test",
    role: "learner",
    assignmentId: 3670,
    groupId: "group-1",
  };

  const contextFor = (
    body: Record<string, unknown>,
    sessionOverride: Record<string, unknown> = session,
  ) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method: "POST",
          originalUrl: "/api/v1/chats/today/lookup",
          path: "/api/v1/chats/today/lookup",
          headers: { "user-session": JSON.stringify(sessionOverride) },
          params: {},
          body,
        }),
      }),
    }) as unknown as ExecutionContext;

  const chatRequestFor = (method: string, requester: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          originalUrl: "/api/v1/chats/chat-1",
          path: "/api/v1/chats/chat-1",
          headers: { "user-session": JSON.stringify(requester) },
          params: { chatId: "chat-1" },
          body: {},
        }),
      }),
    }) as unknown as ExecutionContext;

  const chatListRequestFor = (
    targetUserId: string,
    requester: Record<string, unknown>,
  ) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method: "GET",
          originalUrl: `/api/v1/chats/user/${targetUserId}`,
          path: `/api/v1/chats/user/${targetUserId}`,
          headers: { "user-session": JSON.stringify(requester) },
          params: { userId: targetUserId },
          body: {},
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    findFirst = jest.fn();
    findUnique = jest.fn();
    const logger = { warn: jest.fn(), child: jest.fn() };
    logger.child.mockReturnValue(logger);
    guard = new ChatAccessControlGuard(
      new Reflector(),
      {
        assignmentGroup: { findFirst },
        chat: { findUnique },
      } as unknown as PrismaService,
      logger as unknown as Logger,
    );
  });

  describe("opening today's chat", () => {
    // The group is linked only to the session's assignment.
    beforeEach(() => {
      findFirst.mockImplementation(
        ({ where }: { where: { assignmentId: number; groupId: string } }) =>
          Promise.resolve(
            where.assignmentId === 3670 && where.groupId === "group-1"
              ? where
              : null,
          ),
      );
    });

    it("allows a session whose group is linked to its assignment", async () => {
      await expect(guard.canActivate(contextFor({}))).resolves.toBe(true);
    });

    it("rejects a session whose group is not linked, even when the body names no assignment", async () => {
      await expect(
        guard.canActivate(contextFor({}, { ...session, assignmentId: 42 })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("checks the session's assignment rather than one named in the body", async () => {
      await expect(
        guard.canActivate(
          contextFor({ assignmentId: 3670 }, { ...session, assignmentId: 42 }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("never sends a malformed body assignment to the database", async () => {
      await expect(
        guard.canActivate(contextFor({ assignmentId: "not-a-number" })),
      ).resolves.toBe(true);
      for (const [query] of findFirst.mock.calls as [
        { where: { assignmentId: unknown } },
      ][]) {
        expect(query.where.assignmentId).toBe(3670);
      }
    });
  });

  describe("chats are private to their owner", () => {
    const owned = { id: "chat-1", userId: session.userId, assignmentId: 3670 };

    beforeEach(() => {
      findUnique.mockResolvedValue(owned);
      findFirst.mockResolvedValue({ assignmentId: 3670, groupId: "group-1" });
    });

    it("allows the owner", async () => {
      await expect(
        guard.canActivate(chatRequestFor("GET", session)),
      ).resolves.toBe(true);
    });

    it.each(["learner", "author", "admin"])(
      "rejects a %s in the same assignment group",
      async (role) => {
        await expect(
          guard.canActivate(
            chatRequestFor("POST", {
              ...session,
              userId: "someone-else@example.test",
              role,
            }),
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      },
    );

    it("rejects an admin listing another user's chats", async () => {
      await expect(
        guard.canActivate(
          chatListRequestFor(session.userId, {
            ...session,
            userId: "admin@example.test",
            role: "admin",
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it("rejects a lookup for another user", async () => {
    await expect(
      guard.canActivate(contextFor({ userId: "someone-else@example.test" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
