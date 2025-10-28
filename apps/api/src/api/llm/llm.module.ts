import { Global, Module } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";
import { S3Service } from "../files/services/s3.service";
import { Gpt5LlmService } from "./core/services/gpt5-llm.service";
import { Gpt5MiniLlmService } from "./core/services/gpt5-mini-llm.service";
import { Gpt5NanoLlmService } from "./core/services/gpt5-nano-llm.service";
import { GptOss120bLlmService } from "./core/services/gpt-oss-120b-llm-service";
import { Granite4HSmallLlmService } from "./core/services/granite-4-h-small-llm-service";
import { GraniteVision322bLlmService } from "./core/services/granite-vision-3-2-2b-llm-service";
import { Llama3370bInstructLlmService } from "./core/services/llama-3-3-70b-instruct-llm-service";
import { Llama4MaverickLlmService } from "./core/services/llama-4-maverick-llm-service";
import { MistralMedium2505LlmService } from "./core/services/mistral-medium-2505-llm-service";
import { LLMAssignmentService } from "./core/services/llm-assignment.service";
import { LLMPricingService } from "./core/services/llm-pricing.service";
import { LLMResolverService } from "./core/services/llm-resolver.service";
import { LlmRouter } from "./core/services/llm-router.service";
import { ModerationService } from "./core/services/moderation.service";
import { OpenAiLlmMiniService } from "./core/services/openai-llm-mini.service";
import { Gpt4VisionPreviewLlmService } from "./core/services/openai-llm-vision.service";
import { OpenAiLlmService } from "./core/services/openai-llm.service";
// import { LlamaLlmService } from "./core/services/llama-llm.service";
import { PromptProcessorService } from "./core/services/prompt-processor.service";
import { TokenCounterService } from "./core/services/token-counter.service";
import { UsageTrackerService } from "./core/services/usage-tracking.service";
import { FileGradingService } from "./features/grading/services/file-grading.service";
import { GradingJudgeService } from "./features/grading/services/grading-judge.service";
import { GradingThresholdService } from "./features/grading/services/grading-threshold.service";
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
  GRADING_JUDGE_SERVICE,
  GRADING_THRESHOLD_SERVICE,
  IMAGE_GRADING_SERVICE,
  LLM_ASSIGNMENT_SERVICE,
  LLM_PRICING_SERVICE,
  LLM_RESOLVER_SERVICE,
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

@Global()
@Module({
  providers: [
    PrismaService,

    OpenAiLlmService,
    OpenAiLlmMiniService,
    Gpt4VisionPreviewLlmService,
    Gpt5LlmService,
    Gpt5MiniLlmService,
    Gpt5NanoLlmService,
    GptOss120bLlmService,
    Granite4HSmallLlmService,
    GraniteVision322bLlmService,
    Llama3370bInstructLlmService,
    Llama4MaverickLlmService,
    MistralMedium2505LlmService,
    // LlamaLlmService,
    LlmRouter,
    {
      provide: ALL_LLM_PROVIDERS,
      useFactory: (
        p1: OpenAiLlmService,
        p2: OpenAiLlmMiniService,
        p3: Gpt4VisionPreviewLlmService,
        p4: Gpt5LlmService,
        p5: Gpt5MiniLlmService,
        p6: Gpt5NanoLlmService,
        p7: GptOss120bLlmService,
        p8: Granite4HSmallLlmService,
        p9: GraniteVision322bLlmService,
        p10: Llama3370bInstructLlmService,
        p11: Llama4MaverickLlmService,
        p12: MistralMedium2505LlmService,
        // p13: LlamaLlmService,
      ) => {
        return [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12];
      },
      inject: [
        OpenAiLlmService,
        OpenAiLlmMiniService,
        Gpt4VisionPreviewLlmService,
        Gpt5LlmService,
        Gpt5MiniLlmService,
        Gpt5NanoLlmService,
        GptOss120bLlmService,
        Granite4HSmallLlmService,
        GraniteVision322bLlmService,
        Llama3370bInstructLlmService,
        Llama4MaverickLlmService,
        MistralMedium2505LlmService,
        // LlamaLlmService,
      ],
    },
    S3Service,
    {
      provide: GRADING_JUDGE_SERVICE,
      useClass: GradingJudgeService,
    },
    {
      provide: GRADING_THRESHOLD_SERVICE,
      useClass: GradingThresholdService,
    },
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
      provide: LLM_PRICING_SERVICE,
      useClass: LLMPricingService,
    },
    {
      provide: LLM_ASSIGNMENT_SERVICE,
      useClass: LLMAssignmentService,
    },
    {
      provide: LLM_RESOLVER_SERVICE,
      useClass: LLMResolverService,
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
    GRADING_JUDGE_SERVICE,
    GRADING_THRESHOLD_SERVICE,
    LLM_PRICING_SERVICE,
    LLM_ASSIGNMENT_SERVICE,
    LLM_RESOLVER_SERVICE,
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
