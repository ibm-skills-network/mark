/* eslint-disable @typescript-eslint/require-await */

import { Injectable } from "@nestjs/common";
import { Chat, ChatMessage, ChatRole, Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";

/**
 * Repository for Chat-related database operations
 */
@Injectable()
export class ChatRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new chat session
   */
  async createChat(
    userId: string,
    assignmentId?: number,
    title?: string,
  ): Promise<Chat> {
    return this.prisma.chat.create({
      data: {
        userId,
        assignmentId: assignmentId || undefined,
        title:
          title || `Chat Session - ${new Date().toISOString().split("T")[0]}`,
      },
    });
  }

  /**
   * Find a chat by its ID
   */
  async findChatById(
    chatId: string,
    includeMessages = false,
  ): Promise<
    | (Chat & {
        messages?: ChatMessage[];
        assignment?: { name: string };
      })
    | null
  > {
    return this.prisma.chat.findUnique({
      where: {
        id: chatId,
      },
      include: includeMessages
        ? {
            messages: {
              orderBy: {
                timestamp: "asc",
              },
            },
            assignment: {
              select: {
                name: true,
              },
            },
          }
        : {
            assignment: {
              select: {
                name: true,
              },
            },
          },
    });
  }

  /**
   * Find all chats for a specific user
   */
  async findChatsByUserId(userId: string): Promise<Chat[]> {
    return this.prisma.chat.findMany({
      where: {
        userId,
      },
      orderBy: {
        lastActiveAt: "desc",
      },
      include: {
        assignment: {
          select: {
            name: true,
          },
        },
      },
    });
  }

  /**
   * Find an active chat from today for the user
   */
  async findActiveChatForToday(
    userId: string,
    assignmentId?: number,
  ): Promise<(Chat & { messages: ChatMessage[] }) | null> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.prisma.chat.findFirst({
      where: {
        userId,
        startedAt: {
          gte: today,
          lt: tomorrow,
        },
        isActive: true,
        assignmentId: assignmentId || undefined,
      },
      orderBy: {
        startedAt: "desc",
      },
      include: {
        messages: {
          orderBy: {
            timestamp: "asc",
          },
        },
      },
    });
  }

  /**
   * Update the last activity timestamp of a chat
   */
  async updateChatActivity(chatId: string): Promise<Chat> {
    return this.prisma.chat.update({
      where: {
        id: chatId,
      },
      data: {
        lastActiveAt: new Date(),
      },
    });
  }

  /**
   * Mark a chat as inactive
   */
  async markChatInactive(chatId: string): Promise<Chat> {
    return this.prisma.chat.update({
      where: {
        id: chatId,
      },
      data: {
        isActive: false,
      },
    });
  }

  /**
   * Add a message to a chat
   */
  async addMessage(
    chatId: string,
    role: ChatRole,
    content: string,
    toolCalls?: Prisma.JsonValue,
  ): Promise<ChatMessage> {
    await this.updateChatActivity(chatId);

    const result = await this.prisma.chatMessage.create({
      data: {
        chatId,
        role,
        content,
        toolCalls: toolCalls || undefined,
      },
    });

    return result;
  }

  /**
   * Get messages for a chat with pagination
   */
  async getMessages(
    chatId: string,
    limit = 100,
    offset = 0,
  ): Promise<ChatMessage[]> {
    return this.prisma.chatMessage.findMany({
      where: {
        chatId,
      },
      orderBy: {
        timestamp: "asc",
      },
      skip: offset,
      take: limit,
    });
  }

  /**
   * Get the total number of messages in a chat
   */
  async getMessageCount(chatId: string): Promise<number> {
    const result = await this.prisma.chatMessage.count({
      where: {
        chatId,
      },
    });

    return result;
  }

  /**
   * Search messages in a chat
   */
  async searchMessages(
    chatId: string,
    searchTerm: string,
    limit = 100,
  ): Promise<ChatMessage[]> {
    return this.prisma.chatMessage.findMany({
      where: {
        chatId,
        content: {
          contains: searchTerm,
          mode: "insensitive",
        },
      },
      orderBy: {
        timestamp: "desc",
      },
      take: limit,
    });
  }
}
