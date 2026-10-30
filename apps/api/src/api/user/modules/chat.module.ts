import { Module } from "@nestjs/common";
import { ChatController } from "../controllers/chat.controller";
import { ChatAccessControlGuard } from "../guards/chat.access.control.guard";
import { ChatRepository } from "../repositories/chat.repository";
import { MarkChatService } from "../services/mark-chat.service";
import { ChatService } from "../services/chat.service";

@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    MarkChatService,
    ChatAccessControlGuard,
    ChatRepository,
  ],
  exports: [ChatService],
})
export class ChatModule {}
