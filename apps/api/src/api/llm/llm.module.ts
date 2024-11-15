import { Module } from "@nestjs/common";
import { PrismaService } from "../../prisma.service";
import { LlmService } from "./llm.service";

@Module({
  providers: [LlmService, PrismaService],
  exports: [LlmService],
})
export class LlmModule {}
