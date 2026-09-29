import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JsonValue } from "@prisma/client/runtime/library";
import {
  UserSession,
  UserSessionRequest,
} from "src/auth/interfaces/user.session.interface";
import { Response } from "express";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { AddChatMessageDto } from "../dto/add-chat-message.dto";
import { OpenChatDto, RespondChatDto } from "../dto/chat-request.dto";
import { ChatAccessControlGuard } from "../guards/chat.access.control.guard";
import { MarkChatService } from "../services/mark-chat.service";
import { ChatService } from "../services/chat.service";

@ApiTags("chats")
@Injectable()
@Controller({
  path: "chats",
  version: "1",
})
export class ChatController {
  private readonly logger: Logger;

  constructor(
    private chatService: ChatService,
    private markChatService: MarkChatService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: ChatController.name });
  }

  /**
   * Who the chat belongs to, and which assignment it is scoped to, come from
   * the session the gateway authenticated — never from the request body. A
   * body that disagrees is logged and discarded.
   */
  private identityFromSession(
    userSession: UserSession,
    body: OpenChatDto,
    route: string,
  ): { userId: string; assignmentId?: number } {
    const assignmentId =
      Number.isInteger(userSession.assignmentId) && userSession.assignmentId > 0
        ? userSession.assignmentId
        : undefined;

    const userMismatch = !!body?.userId && body.userId !== userSession.userId;
    const assignmentMismatch =
      body?.assignmentId !== undefined && body.assignmentId !== assignmentId;

    if (userMismatch || assignmentMismatch) {
      this.logger.warn(
        "chat_identity_from_session: request body disagreed with the session",
        {
          route,
          user_id: userSession.userId,
          requested_user_id: userMismatch ? body.userId : undefined,
          assignment_id: assignmentId,
          requested_assignment_id: assignmentMismatch
            ? body.assignmentId
            : undefined,
        },
      );
    }

    return { userId: userSession.userId, assignmentId };
  }

  @Post()
  @UseGuards(ChatAccessControlGuard)
  async createChat(
    @Body() body: OpenChatDto,
    @Req() request: UserSessionRequest,
  ) {
    const { userId, assignmentId } = this.identityFromSession(
      request.userSession,
      body,
      "create",
    );
    return this.chatService.createChat(userId, assignmentId);
  }

  @Post("today")
  @UseGuards(ChatAccessControlGuard)
  async getTodayChat(
    @Body() body: OpenChatDto,
    @Req() request: UserSessionRequest,
  ) {
    const { userId, assignmentId } = this.identityFromSession(
      request.userSession,
      body,
      "today",
    );
    return this.chatService.getOrCreateTodayChat(userId, assignmentId);
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
    @Body() body: AddChatMessageDto,
    @Req() request: UserSessionRequest,
  ) {
    return await this.chatService.addMessage(
      chatId,
      body.role,
      body.content,
      body.toolCalls as JsonValue | undefined,
      request.userSession,
    );
  }

  @Post(":chatId/end")
  @UseGuards(ChatAccessControlGuard)
  async endChat(@Param("chatId") chatId: string) {
    return this.chatService.endChat(chatId);
  }

  @Post(":chatId/respond")
  @UseGuards(ChatAccessControlGuard)
  async respond(
    @Param("chatId") chatId: string,
    @Body() body: RespondChatDto,
    @Req() request: UserSessionRequest,
  ) {
    return this.markChatService.respond(chatId, body, request.userSession);
  }

  @Post(":chatId/respond-stream")
  @UseGuards(ChatAccessControlGuard)
  async respondStream(
    @Param("chatId") chatId: string,
    @Body() body: RespondChatDto,
    @Req() request: UserSessionRequest,
    @Res() response: Response,
  ) {
    await this.markChatService.respondStream(
      chatId,
      body,
      request.userSession,
      response,
    );
  }
}
