import { HttpModule } from "@nestjs/axios";
import { Global, Module } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";
import { JobStatusServiceV2 } from "./api/assignment/v2/services/job-status.service";
import { TranslationService } from "./api/assignment/v2/services/translation.service";
import { LlmModule } from "./api/llm/llm.module";

@Global()
@Module({
  imports: [HttpModule, LlmModule],
  providers: [PrismaService, TranslationService, JobStatusServiceV2],
  exports: [PrismaService, TranslationService, JobStatusServiceV2, HttpModule],
})
export class SharedModule {}
