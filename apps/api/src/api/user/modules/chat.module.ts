import { Module } from "@nestjs/common";
import { PrismaService } from "src/prisma.service";
import { ChatController } from "../controllers/chat.controller";
import { ChatAccessControlGuard } from "../guards/chat.access.control.guard";
import { ChatService } from "../services/chat.service";
import { ChatRepository } from "../repositories/chat.repository";

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
