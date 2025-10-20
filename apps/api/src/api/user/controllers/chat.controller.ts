import {
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ChatRole } from "@prisma/client";
import { JsonValue } from "@prisma/client/runtime/library";
import { ChatAccessControlGuard } from "../guards/chat.access.control.guard";
import { ChatService } from "../services/chat.service";

@ApiTags("chats")
@Injectable()
@Controller({
  path: "chats",
  version: "1",
})
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Post()
  @UseGuards(ChatAccessControlGuard)
  async createChat(@Body() body: { userId: string; assignmentId?: number }) {
    return this.chatService.createChat(body.userId, body.assignmentId);
  }

  @Post("today")
  @UseGuards(ChatAccessControlGuard)
  async getTodayChat(@Body() body: { header: string; body: string }) {
    let newBody: { userId: string; assignmentId?: number };
    if (typeof body.body === "string") {
      newBody = JSON.parse(body.body) as {
        userId: string;
        assignmentId?: number;
      };
    }
    return this.chatService.getOrCreateTodayChat(
      newBody.userId,
      newBody.assignmentId,
    );
  }

  @Get("user/:userId")
  @UseGuards(ChatAccessControlGuard)
  async getUserChats(@Param("userId") userId: string) {
    return this.chatService.getUserChats(userId);
  }

  @Get(":chatId")
  @UseGuards(ChatAccessControlGuard)
  async getChat(@Param("chatId") chatId: string) {
    return this.chatService.getChatById(chatId);
  }

  @Post(":chatId/messages")
  @UseGuards(ChatAccessControlGuard)
  async addMessage(
    @Param("chatId") chatId: string,
    @Body() body: { role: ChatRole; content: string; toolCalls?: JsonValue },
  ) {
    return await this.chatService.addMessage(
      chatId,
      body.role,
      body.content,
      body.toolCalls,
    );
  }

  @Post(":chatId/end")
  @UseGuards(ChatAccessControlGuard)
  async endChat(@Param("chatId") chatId: string) {
    return this.chatService.endChat(chatId);
  }
}
