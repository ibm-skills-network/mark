import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Chat, ChatMessage, ChatRole } from "@prisma/client";
import { JsonValue } from "@prisma/client/runtime/library";
import { S3Service } from "src/api/files/services/s3.service";
import { UserSession } from "src/auth/interfaces/user.session.interface";
import { ChatRepository } from "../repositories/chat.repository";
import {
  hasFileAttachmentToolCalls,
  normalizeChatFileAttachmentToolCalls,
} from "./chat-file-attachments";

@Injectable()
export class ChatService {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Create a new chat session
   */
  async createChat(userId: string, assignmentId?: number): Promise<Chat> {
    const today = new Date().toISOString().split("T")[0];
    const title = `Chat Session - ${today}`;

    return this.chatRepository.createChat(userId, assignmentId, title);
  }

  /**
   * Get user's active chat for today or create a new one
   */
  async getOrCreateTodayChat(
    userId: string,
    assignmentId?: number,
  ): Promise<Chat> {
    const activeChat = await this.chatRepository.findActiveChatForToday(
      userId,
      assignmentId,
    );

    if (activeChat) return activeChat;

    return this.createChat(userId, assignmentId);
  }

  /**
   * Get all chats for a user
   */
  async getUserChats(userId: string): Promise<Chat[]> {
    return this.chatRepository.findChatsByUserId(userId);
  }

  /**
   * Get chat by ID with messages
   */
  async getChatById(
    chatId: string,
  ): Promise<(Chat & { messages?: ChatMessage[] }) | null> {
    return this.chatRepository.findChatById(chatId, true);
  }

  /**
   * Add message to chat
   */
  async addMessage(
    chatId: string,
    role: ChatRole,
    content: string,
    toolCalls?: JsonValue,
    userSession?: UserSession,
  ): Promise<ChatMessage> {
    if (role !== ChatRole.USER) {
      throw new BadRequestException(
        "Only USER role messages can be persisted through the chat API.",
      );
    }

    let sanitizedToolCalls = toolCalls;
    if (role === ChatRole.USER) {
      if (hasFileAttachmentToolCalls(toolCalls)) {
        if (!userSession?.userId) {
          throw new ForbiddenException(
            "Missing user session for file attachments",
          );
        }

        const normalizedToolCalls = normalizeChatFileAttachmentToolCalls(
          toolCalls,
          this.s3Service,
          [userSession.userId],
        );
        const submittedFiles = Array.isArray(
          (toolCalls as { files?: unknown[] })?.files,
        )
          ? (toolCalls as { files: unknown[] }).files.length
          : 0;

        if (
          !normalizedToolCalls ||
          normalizedToolCalls.files.length !== submittedFiles
        ) {
          throw new ForbiddenException(
            "Invalid chat file attachment metadata.",
          );
        }

        sanitizedToolCalls = normalizedToolCalls as unknown as JsonValue;
      } else {
        sanitizedToolCalls = undefined;
      }
    }

    return this.chatRepository.addMessage(
      chatId,
      role,
      content,
      sanitizedToolCalls,
    );
  }

  async getAuthorizedChatFileLinks(
    chatId: string,
    userSession: UserSession,
  ): Promise<Set<string>> {
    const chat = await this.chatRepository.findChatById(chatId, true);
    if (!chat?.messages?.length) {
      return new Set<string>();
    }

    const allowedUserIds = [
      ...new Set([chat.userId, userSession.userId].filter(Boolean)),
    ];
    const links = new Set<string>();

    for (const message of chat.messages) {
      if (message.role !== ChatRole.USER) {
        continue;
      }

      const normalizedToolCalls = normalizeChatFileAttachmentToolCalls(
        message.toolCalls as JsonValue | undefined,
        this.s3Service,
        allowedUserIds,
      );
      if (!normalizedToolCalls) {
        continue;
      }

      for (const file of normalizedToolCalls.files) {
        links.add(file.s3Link);
      }
    }

    return links;
  }

  /**
   * End a chat session (mark as inactive)
   */
  async endChat(chatId: string): Promise<Chat> {
    return this.chatRepository.markChatInactive(chatId);
  }

  /**
   * Get messages for a chat with pagination
   */
  async getChatMessages(
    chatId: string,
    limit = 100,
    offset = 0,
  ): Promise<ChatMessage[]> {
    return this.chatRepository.getMessages(chatId, limit, offset);
  }

  /**
   * Search for messages containing a term
   */
  async searchChatMessages(
    chatId: string,
    searchTerm: string,
  ): Promise<ChatMessage[]> {
    return this.chatRepository.searchMessages(chatId, searchTerm);
  }
}
