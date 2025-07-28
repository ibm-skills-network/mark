import { Global, Module } from "@nestjs/common";
import { PrismaService } from "src/prisma.service";
import { S3Service } from "../files/services/s3.service";
import { LlmRouter } from "./core/services/llm-router.service";
import { ModerationService } from "./core/services/moderation.service";
import { OpenAiLlmMiniService } from "./core/services/openai-llm-mini.service";
import { OpenAiLlmService } from "./core/services/openai-llm.service";
import { PromptProcessorService } from "./core/services/prompt-processor.service";
import { TokenCounterService } from "./core/services/token-counter.service";
import { UsageTrackerService } from "./core/services/usage-tracking.service";
import { FileGradingService } from "./features/grading/services/file-grading.service";
import { ImageGradingService } from "./features/grading/services/image-grading.service";
import { PresentationGradingService } from "./features/grading/services/presentation-grading.service";
import { TextGradingService } from "./features/grading/services/text-grading.service";
import { UrlGradingService } from "./features/grading/services/url-grading.service";
import { VideoPresentationGradingService } from "./features/grading/services/video-grading.service";
import { QuestionGenerationService } from "./features/question-generation/services/question-generation.service";
import { QuestionValidatorService } from "./features/question-generation/services/question-validator.service";
import { RubricService } from "./features/rubric/services/rubric.service";
import { TranslationService } from "./features/translation/services/translation.service";
import { LlmFacadeService } from "./llm-facade.service";
import {
  ALL_LLM_PROVIDERS,
  FILE_GRADING_SERVICE,
  IMAGE_GRADING_SERVICE,
  MODERATION_SERVICE,
  PRESENTATION_GRADING_SERVICE,
  PROMPT_PROCESSOR,
  QUESTION_GENERATION_SERVICE,
  RUBRIC_SERVICE,
  TEXT_GRADING_SERVICE,
  TOKEN_COUNTER,
  TRANSLATION_SERVICE,
  URL_GRADING_SERVICE,
  USAGE_TRACKER,
  VALIDATOR_SERVICE,
  VIDEO_PRESENTATION_GRADING_SERVICE,
} from "./llm.constants";
import { Gpt4VisionPreviewLlmService } from "./core/services/openai-llm-vision.service";

@Global()
@Module({
  providers: [
    PrismaService,

    OpenAiLlmService,
    OpenAiLlmMiniService,
    Gpt4VisionPreviewLlmService,
    LlmRouter,
    {
      provide: ALL_LLM_PROVIDERS,
      useFactory: (
        p1: OpenAiLlmService,
        p2: OpenAiLlmMiniService,
        p3: Gpt4VisionPreviewLlmService,
      ) => {
        return [p1, p2, p3];
      },
      inject: [
        OpenAiLlmService,
        OpenAiLlmMiniService,
        Gpt4VisionPreviewLlmService,
      ],
    },
    S3Service,

    {
      provide: VALIDATOR_SERVICE,
      useClass: QuestionValidatorService,
    },
    {
      provide: PROMPT_PROCESSOR,
      useClass: PromptProcessorService,
    },
    {
      provide: MODERATION_SERVICE,
      useClass: ModerationService,
    },
    {
      provide: TOKEN_COUNTER,
      useClass: TokenCounterService,
    },
    {
      provide: USAGE_TRACKER,
      useClass: UsageTrackerService,
    },

    {
      provide: TEXT_GRADING_SERVICE,
      useClass: TextGradingService,
    },
    {
      provide: FILE_GRADING_SERVICE,
      useClass: FileGradingService,
    },
    {
      provide: IMAGE_GRADING_SERVICE,
      useClass: ImageGradingService,
    },
    {
      provide: URL_GRADING_SERVICE,
      useClass: UrlGradingService,
    },
    {
      provide: PRESENTATION_GRADING_SERVICE,
      useClass: PresentationGradingService,
    },
    {
      provide: VIDEO_PRESENTATION_GRADING_SERVICE,
      useClass: VideoPresentationGradingService,
    },
    {
      provide: QUESTION_GENERATION_SERVICE,
      useClass: QuestionGenerationService,
    },
    {
      provide: RUBRIC_SERVICE,
      useClass: RubricService,
    },
    {
      provide: TRANSLATION_SERVICE,
      useClass: TranslationService,
    },

    LlmFacadeService,
  ],
  exports: [
    LlmFacadeService,

    ALL_LLM_PROVIDERS,
    LlmRouter,
    PROMPT_PROCESSOR,
    MODERATION_SERVICE,
    TOKEN_COUNTER,
    USAGE_TRACKER,
    TEXT_GRADING_SERVICE,
    FILE_GRADING_SERVICE,
    IMAGE_GRADING_SERVICE,
    URL_GRADING_SERVICE,
    PRESENTATION_GRADING_SERVICE,
    VIDEO_PRESENTATION_GRADING_SERVICE,
    QUESTION_GENERATION_SERVICE,
    RUBRIC_SERVICE,
    TRANSLATION_SERVICE,
  ],
})
export class LlmModule {}
