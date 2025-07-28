import { Injectable } from "@nestjs/common";
import { Chat, ChatMessage, ChatRole, Prisma } from "@prisma/client";
import { ChatRepository } from "../repositories/chat.repository";
import { JsonValue } from "@prisma/client/runtime/library";

@Injectable()
export class ChatService {
  constructor(private readonly chatRepository: ChatRepository) {}

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
  async getChatById(chatId: string): Promise<Chat | null> {
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
  ): Promise<ChatMessage> {
    return this.chatRepository.addMessage(chatId, role, content, toolCalls);
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
