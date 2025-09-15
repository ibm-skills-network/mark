import { Module } from "@nestjs/common";
import { PrismaService } from "src/prisma.service";
import { ChatController } from "../controllers/chat.controller";
import { ChatAccessControlGuard } from "../guards/chat.access.control.guard";
import { ChatRepository } from "../repositories/chat.repository";
import { ChatService } from "../services/chat.service";

@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    PrismaService,
    ChatAccessControlGuard,
    ChatRepository,
  ],
  exports: [ChatService],
})
export class ChatModule {}
