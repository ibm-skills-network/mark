import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ChatRole } from "@prisma/client";
import { ChatRepository } from "../../../repositories/chat.repository";
import { ChatService } from "../../../services/chat.service";

describe("ChatService", () => {
  let service: ChatService;
  let chatRepository: {
    addMessage: jest.Mock;
    createChat: jest.Mock;
    findActiveChatForToday: jest.Mock;
  };

  beforeEach(async () => {
    chatRepository = {
      addMessage: jest.fn().mockResolvedValue({ id: "message-1" }),
      createChat: jest.fn().mockResolvedValue({ id: "new-chat" }),
      findActiveChatForToday: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: ChatRepository, useValue: chatRepository },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  it("rejects persisted system messages from the public chat API", async () => {
    await expect(
      service.addMessage("chat-1", ChatRole.SYSTEM, "system"),
    ).rejects.toThrow(BadRequestException);
    expect(chatRepository.addMessage).not.toHaveBeenCalled();
  });

  it("persists user messages through the repository", async () => {
    await expect(
      service.addMessage("chat-1", ChatRole.USER, "hello"),
    ).resolves.toEqual({ id: "message-1" });

    expect(chatRepository.addMessage).toHaveBeenCalledWith(
      "chat-1",
      ChatRole.USER,
      "hello",
    );
  });

  describe("findTodayChat", () => {
    it("returns the existing chat without creating one", async () => {
      const existing = { id: "chat-1", messages: [{ id: "m1" }] };
      chatRepository.findActiveChatForToday.mockResolvedValue(existing);

      await expect(service.findTodayChat("user-1", 7)).resolves.toBe(existing);
      expect(chatRepository.findActiveChatForToday).toHaveBeenCalledWith(
        "user-1",
        7,
      );
      expect(chatRepository.createChat).not.toHaveBeenCalled();
    });

    it("returns null and creates nothing when there is no chat today", async () => {
      await expect(service.findTodayChat("user-1", 7)).resolves.toBeNull();
      expect(chatRepository.createChat).not.toHaveBeenCalled();
    });
  });

  describe("getOrCreateTodayChat", () => {
    it("reuses today's chat when one exists", async () => {
      const existing = { id: "chat-1", messages: [] };
      chatRepository.findActiveChatForToday.mockResolvedValue(existing);

      await expect(service.getOrCreateTodayChat("user-1", 7)).resolves.toBe(
        existing,
      );
      expect(chatRepository.createChat).not.toHaveBeenCalled();
    });

    it("creates a chat only when none exists", async () => {
      await expect(service.getOrCreateTodayChat("user-1", 7)).resolves.toEqual({
        id: "new-chat",
      });
      expect(chatRepository.createChat).toHaveBeenCalledTimes(1);
      expect(chatRepository.createChat).toHaveBeenCalledWith(
        "user-1",
        7,
        expect.stringContaining("Chat Session"),
      );
    });
  });
});
