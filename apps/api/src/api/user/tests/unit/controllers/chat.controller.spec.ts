import { Test, TestingModule } from "@nestjs/testing";
import { Response } from "express";
import {
  UserRole,
  UserSession,
  UserSessionRequest,
} from "src/auth/interfaces/user.session.interface";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PrismaService } from "src/database/prisma.service";
import { ChatController } from "../../../controllers/chat.controller";
import { ChatService } from "../../../services/chat.service";
import { MarkChatService } from "../../../services/mark-chat.service";

describe("ChatController identity", () => {
  let controller: ChatController;
  let chatService: {
    createChat: jest.Mock;
    getOrCreateTodayChat: jest.Mock;
  };
  let markChatService: { respond: jest.Mock; respondStream: jest.Mock };
  let warn: jest.Mock;

  const learnerSession: UserSession = {
    userId: "learner-1@example.test",
    role: UserRole.LEARNER,
    assignmentId: 3670,
    groupId: "group-1",
  };

  const requestOf = (userSession: UserSession) =>
    ({ userSession }) as UserSessionRequest;

  beforeEach(async () => {
    chatService = {
      createChat: jest.fn().mockResolvedValue({ id: "chat-1" }),
      getOrCreateTodayChat: jest.fn().mockResolvedValue({ id: "chat-1" }),
    };
    markChatService = {
      respond: jest.fn().mockResolvedValue({ reply: "ok" }),
      respondStream: jest.fn().mockResolvedValue(undefined),
    };

    warn = jest.fn();
    const logger = {
      child: jest.fn(),
      warn,
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    logger.child.mockReturnValue(logger);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: chatService },
        { provide: MarkChatService, useValue: markChatService },
        { provide: WINSTON_MODULE_PROVIDER, useValue: logger },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get<ChatController>(ChatController);
  });

  it("creates a chat for the session user, not the one named in the body", async () => {
    await controller.createChat(
      { userId: "someone-else@example.test", assignmentId: 999999 },
      requestOf(learnerSession),
    );

    expect(chatService.createChat).toHaveBeenCalledWith(
      learnerSession.userId,
      learnerSession.assignmentId,
    );
  });

  it("opens today's chat for the session user, not the one named in the body", async () => {
    await controller.getTodayChat(
      { userId: "someone-else@example.test", assignmentId: 999999 },
      requestOf(learnerSession),
    );

    expect(chatService.getOrCreateTodayChat).toHaveBeenCalledWith(
      learnerSession.userId,
      learnerSession.assignmentId,
    );
  });

  it("opens today's chat when the body carries no identity at all", async () => {
    await controller.getTodayChat({}, requestOf(learnerSession));

    expect(chatService.getOrCreateTodayChat).toHaveBeenCalledWith(
      learnerSession.userId,
      learnerSession.assignmentId,
    );
  });

  it("logs a warning when the body names a different user", async () => {
    await controller.getTodayChat(
      { userId: "someone-else@example.test" },
      requestOf(learnerSession),
    );

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("chat_identity"),
      expect.objectContaining({ user_id: learnerSession.userId }),
    );
  });

  it("hands the respond route the session, not a body-declared role", async () => {
    const body = {
      userRole: "author" as const,
      userText: "hello",
      conversation: [],
    };

    await controller.respond("chat-1", body, requestOf(learnerSession));

    expect(markChatService.respond).toHaveBeenCalledWith(
      "chat-1",
      body,
      learnerSession,
    );
  });

  it("hands the streaming route the session, not a body-declared role", async () => {
    const body = {
      userRole: "author" as const,
      userText: "hello",
      conversation: [],
    };
    const response = {} as Response;

    await controller.respondStream(
      "chat-1",
      body,
      requestOf(learnerSession),
      response,
    );

    expect(markChatService.respondStream).toHaveBeenCalledWith(
      "chat-1",
      body,
      learnerSession,
      response,
    );
  });
});
