import { Module } from "@nestjs/common";
import { FileContentExtractionService } from "src/api/attempt/services/file-content-extraction";
import { PdfStructureExtractorService } from "src/api/attempt/services/pdf-structure-extractor.service";
import { S3Service } from "src/api/files/services/s3.service";
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
    FileContentExtractionService,
    PdfStructureExtractorService,
    S3Service,
  ],
  exports: [ChatService],
})
export class ChatModule {}
