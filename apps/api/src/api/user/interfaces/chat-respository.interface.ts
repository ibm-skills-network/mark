import { Chat, ChatMessage, ChatRole } from "@prisma/client";

export interface IChatRepository {
  createChat(
    userId: string,
    assignmentId?: number,
    title?: string,
  ): Promise<Chat>;
  findChatById(chatId: string, includeMessages?: boolean): Promise<Chat>;
  findChatsByUserId(userId: string): Promise<Chat[]>;
  findActiveChatForToday(userId: string, assignmentId?: number): Promise<Chat>;
  updateChatActivity(chatId: string): Promise<Chat>;
  markChatInactive(chatId: string): Promise<Chat>;

  addMessage(
    chatId: string,
    role: ChatRole,
    content: string,
    toolCalls?: any,
  ): Promise<ChatMessage>;
  getMessages(
    chatId: string,
    limit?: number,
    offset?: number,
  ): Promise<ChatMessage[]>;
}
