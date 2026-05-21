import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ChatRole } from "@prisma/client";
import { S3Service } from "src/api/files/services/s3.service";
import {
  UserRole,
  UserSession,
} from "src/auth/interfaces/user.session.interface";
import { ChatRepository } from "../../../repositories/chat.repository";
import { ChatService } from "../../../services/chat.service";

describe("ChatService", () => {
  let service: ChatService;
  let chatRepository: {
    addMessage: jest.Mock;
    findChatById: jest.Mock;
  };
  let s3Service: {
    getBucketName: jest.Mock;
  };

  const userSession: UserSession = {
    userId: "user-1",
    role: UserRole.AUTHOR,
    assignmentId: 1,
    groupId: "group-1",
  };

  beforeEach(async () => {
    chatRepository = {
      addMessage: jest.fn().mockResolvedValue({ id: "message-1" }),
      findChatById: jest.fn().mockResolvedValue(null),
    };

    s3Service = {
      getBucketName: jest.fn((uploadType: string) => {
        if (uploadType === "author") return "author-bucket";
        if (uploadType === "chatbot") return "learner-bucket";
        throw new Error(`Unexpected upload type ${uploadType}`);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: ChatRepository, useValue: chatRepository },
        { provide: S3Service, useValue: s3Service },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  it("rejects persisted system messages from the public chat API", async () => {
    await expect(
      service.addMessage(
        "chat-1",
        ChatRole.SYSTEM,
        "system",
        undefined,
        userSession,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(chatRepository.addMessage).not.toHaveBeenCalled();
  });

  it("normalizes valid user file attachment metadata before persisting", async () => {
    await service.addMessage(
      "chat-1",
      ChatRole.USER,
      "Here is a file",
      {
        type: "file_attachments",
        files: [
          {
            id: "file-1",
            filename: "notes.pdf",
            size: 123,
            contentType: "application/pdf",
            extension: "pdf",
            s3Bucket: "author-bucket",
            s3Key: "authors/user-1/abc-notes.pdf",
            s3Link: "s3://author-bucket/authors/user-1/abc-notes.pdf",
            ignored: "value",
          },
        ],
      } as any,
      userSession,
    );

    expect(chatRepository.addMessage).toHaveBeenCalledWith(
      "chat-1",
      ChatRole.USER,
      "Here is a file",
      {
        type: "file_attachments",
        files: [
          {
            id: "file-1",
            filename: "notes.pdf",
            size: 123,
            contentType: "application/pdf",
            extension: "pdf",
            s3Bucket: "author-bucket",
            s3Key: "authors/user-1/abc-notes.pdf",
            s3Link: "s3://author-bucket/authors/user-1/abc-notes.pdf",
          },
        ],
      },
    );
  });

  it("rejects forged user file attachment metadata outside the caller's prefix", async () => {
    await expect(
      service.addMessage(
        "chat-1",
        ChatRole.USER,
        "forged",
        {
          type: "file_attachments",
          files: [
            {
              filename: "secrets.pdf",
              s3Bucket: "author-bucket",
              s3Key: "authors/another-user/secrets.pdf",
            },
          ],
        } as any,
        userSession,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(chatRepository.addMessage).not.toHaveBeenCalled();
  });

  it("authorizes only sanitized persisted user attachment links for the active chat", async () => {
    chatRepository.findChatById.mockResolvedValue({
      id: "chat-1",
      userId: "owner-1",
      messages: [
        {
          role: ChatRole.USER,
          toolCalls: {
            type: "file_attachments",
            files: [
              {
                filename: "owner-file.pdf",
                s3Bucket: "author-bucket",
                s3Key: "authors/owner-1/owner-file.pdf",
              },
              {
                filename: "current-user-file.pdf",
                s3Bucket: "learner-bucket",
                s3Key: "chatbot/user-1/current-user-file.pdf",
              },
              {
                filename: "forged.pdf",
                s3Bucket: "author-bucket",
                s3Key: "authors/random-user/forged.pdf",
              },
            ],
          },
        },
        {
          role: ChatRole.ASSISTANT,
          toolCalls: {
            type: "file_attachments",
            files: [
              {
                filename: "assistant-file.pdf",
                s3Bucket: "author-bucket",
                s3Key: "authors/owner-1/assistant-file.pdf",
              },
            ],
          },
        },
      ],
    });

    const links = await service.getAuthorizedChatFileLinks(
      "chat-1",
      userSession,
    );

    expect(Array.from(links)).toEqual([
      "s3://author-bucket/authors/owner-1/owner-file.pdf",
      "s3://learner-bucket/chatbot/user-1/current-user-file.pdf",
    ]);
  });
});
