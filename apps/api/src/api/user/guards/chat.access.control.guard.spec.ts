import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ChatAccessControlGuard } from "./chat.access.control.guard";

const makeLogger = () => ({
  child: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
});

const makeRequest = (
  sessionObj: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) => ({
  headers: { "user-session": sessionObj },
  method: "GET",
  originalUrl: "/api/v1/users/admin@ibm.com/chats",
  path: "/api/v1/users/admin@ibm.com/chats",
  params: {},
  body: {},
  ...extra,
});

describe("ChatAccessControlGuard — admin override", () => {
  it("allows any request when adminOverride is set, without a DB lookup", async () => {
    const prisma = {
      chat: { findUnique: jest.fn() },
      assignmentGroup: { findFirst: jest.fn() },
    };
    const guard = new ChatAccessControlGuard(
      {} as never,
      prisma as never,
      makeLogger() as never,
    );
    const ctx = {
      switchToHttp: () => ({
        getRequest: () =>
          makeRequest({
            userId: "admin@ibm.com",
            role: "author",
            adminOverride: true,
          }),
      }),
    } as never;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.chat.findUnique).not.toHaveBeenCalled();
    expect(prisma.assignmentGroup.findFirst).not.toHaveBeenCalled();
  });
});

describe("ChatAccessControlGuard — existing denial behavior unchanged", () => {
  it("throws ForbiddenException when chat owner mismatch and no assignment link (no override)", async () => {
    const prisma = {
      chat: {
        findUnique: jest.fn().mockResolvedValue({
          id: "chat-1",
          userId: "owner@ibm.com",
          assignmentId: null,
        }),
      },
      assignmentGroup: { findFirst: jest.fn() },
    };
    const guard = new ChatAccessControlGuard(
      new Reflector(),
      prisma as never,
      makeLogger() as never,
    );
    const ctx: ExecutionContext = {
      switchToHttp: () => ({
        getRequest: () =>
          makeRequest(
            { userId: "other@ibm.com", role: "learner" },
            { params: { chatId: "chat-1" } },
          ),
        getResponse: () => ({}),
        getNext: () => undefined,
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.chat.findUnique).toHaveBeenCalledTimes(1);
  });

  it("throws ForbiddenException when session is missing userId", async () => {
    const prisma = {
      chat: { findUnique: jest.fn() },
      assignmentGroup: { findFirst: jest.fn() },
    };
    const guard = new ChatAccessControlGuard(
      new Reflector(),
      prisma as never,
      makeLogger() as never,
    );
    const ctx: ExecutionContext = {
      switchToHttp: () => ({
        getRequest: () => makeRequest({ role: "learner" /* no userId */ }),
        getResponse: () => ({}),
        getNext: () => undefined,
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.chat.findUnique).not.toHaveBeenCalled();
  });
});
