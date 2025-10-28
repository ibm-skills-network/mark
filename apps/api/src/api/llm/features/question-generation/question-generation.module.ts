import { Module } from "@nestjs/common";
import { WinstonModule } from "nest-winston";
import { PrismaService } from "../../../../database/prisma.service";
import { QUESTION_GENERATION_SERVICE } from "../../llm.constants";
import { LlmModule } from "../../llm.module";
import { QuestionGenerationService } from "./services/question-generation.service";
import { QuestionTemplateService } from "./services/question-template.service";

@Module({
  imports: [LlmModule, WinstonModule],
  providers: [
    PrismaService,
    QuestionTemplateService,
    {
      provide: QUESTION_GENERATION_SERVICE,
      useClass: QuestionGenerationService,
    },
  ],
  exports: [QUESTION_GENERATION_SERVICE],
})
export class QuestionGenerationModule {}
