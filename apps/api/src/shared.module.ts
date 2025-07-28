import { Global, Module } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { PrismaService } from "src/prisma.service";
import { TranslationService } from "./api/assignment/v2/services/translation.service";
import { LlmModule } from "./api/llm/llm.module";
import { JobStatusServiceV2 } from "./api/assignment/v2/services/job-status.service";

@Global()
@Module({
  imports: [HttpModule, LlmModule],
  providers: [PrismaService, TranslationService, JobStatusServiceV2],
  exports: [PrismaService, TranslationService, JobStatusServiceV2, HttpModule],
})
export class SharedModule {}
