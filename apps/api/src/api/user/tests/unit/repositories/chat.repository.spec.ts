import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "src/database/prisma.service";
import { ChatRepository } from "../../../repositories/chat.repository";

describe("ChatRepository", () => {
  let repository: ChatRepository;
  let prisma: { chat: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { chat: { findMany: jest.fn().mockResolvedValue([]) } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ChatRepository, { provide: PrismaService, useValue: prisma }],
    }).compile();

    repository = module.get<ChatRepository>(ChatRepository);
  });

  it("lists only the user's chats that have at least one message", async () => {
    await repository.findChatsByUserId("user-1");

    expect(prisma.chat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", messages: { some: {} } },
      }),
    );
  });
});
