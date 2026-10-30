import { Global, Module } from "@nestjs/common";
import { S3Service } from "../files/services/s3.service";
import { Gpt6LunaLlmService } from "./core/services/gpt6-luna-llm.service";
import {
  Gpt61SolLlmService,
  Gpt61TerraLlmService,
} from "./core/services/gpt61-llm.service";
import { LLMAssignmentService } from "./core/services/llm-assignment.service";
import { LLMPricingService } from "./core/services/llm-pricing.service";
import { LLMResolverService } from "./core/services/llm-resolver.service";
import { LlmRouter } from "./core/services/llm-router.service";
import { ModerationService } from "./core/services/moderation.service";
import { PromptProcessorService } from "./core/services/prompt-processor.service";
import { TokenCounterService } from "./core/services/token-counter.service";
import { UsageTrackerService } from "./core/services/usage-tracking.service";
import { AnswerNormalizationService } from "./features/grading/services/answer-normalization.service";
import { EvidenceChunkingService } from "./features/grading/services/evidence-chunking.service";
import { CriterionEvidenceRetrievalService } from "./features/grading/services/criterion-evidence-retrieval.service";
import { CriterionGradingService } from "./features/grading/services/criterion-grading.service";
import { CriterionJudgeService } from "./features/grading/services/criterion-judge.service";
import { CriterionRetryManagerService } from "./features/grading/services/criterion-retry-manager.service";
import { CriterionGradeCompilerService } from "./features/grading/services/criterion-grade-compiler.service";
import { CriterionEvidencePipelineService } from "./features/grading/services/criterion-evidence-pipeline.service";
import { FileGradingService } from "./features/grading/services/file-grading.service";
import { ContentSummarizationService } from "./features/grading/services/content-summarization.service";
import { EvidenceBasedGradingService } from "./features/grading/services/evidence-based-grading.service";
import { GradingCacheService } from "./features/grading/services/grading-cache.service";
import { GradingJudgeService } from "./features/grading/services/grading-judge.service";
import { NoopGradingJudgeService } from "./features/grading/services/noop-grading-judge.service";
import { GradingThresholdService } from "./features/grading/services/grading-threshold.service";
import { ImageGradingService } from "./features/grading/services/image-grading.service";
import { ImageDescriptionService } from "./features/grading/services/image-description.service";
import { HighlightingGeneratorService } from "./features/grading/services/highlighting-generator.service";
import { PresentationGradingService } from "./features/grading/services/presentation-grading.service";
import { TextGradingService } from "./features/grading/services/text-grading.service";
import { UrlGradingService } from "./features/grading/services/url-grading.service";
import { VideoPresentationGradingService } from "./features/grading/services/video-grading.service";
import { QuestionGenerationService } from "./features/question-generation/services/question-generation.service";
import { QuestionValidatorService } from "./features/question-generation/services/question-validator.service";
import { RubricService } from "./features/rubric/services/rubric.service";
import { TranslationService } from "./features/translation/services/translation.service";
import { IMultimodalLlmProvider } from "./core/interfaces/llm-provider.interface";
import { LlmFacadeService } from "./llm-facade.service";
import {
  ALL_LLM_PROVIDERS,
  ANSWER_NORMALIZATION_SERVICE,
  FILE_GRADING_SERVICE,
  GRADING_CACHE_SERVICE,
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
import { PdfAnnotationService } from "../attempt/services/pdf-annotation.service";

const shouldDisableJudge = !["1", "true", "yes"].includes(
  (process.env.ENABLE_GRADING_JUDGE || "").toLowerCase(),
);

@Global()
@Module({
  providers: [
    Gpt61TerraLlmService,
    Gpt61SolLlmService,
    Gpt6LunaLlmService,
    LlmRouter,
    {
      provide: ALL_LLM_PROVIDERS,
      useFactory: (
        ...providers: IMultimodalLlmProvider[]
      ): IMultimodalLlmProvider[] => providers,
      inject: [Gpt61TerraLlmService, Gpt61SolLlmService, Gpt6LunaLlmService],
    },
    S3Service,
    PdfAnnotationService,
    {
      provide: GRADING_JUDGE_SERVICE,
      useClass: shouldDisableJudge
        ? NoopGradingJudgeService
        : GradingJudgeService,
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
    ContentSummarizationService,
    EvidenceBasedGradingService,
    EvidenceChunkingService,
    CriterionEvidenceRetrievalService,
    CriterionGradingService,
    CriterionJudgeService,
    CriterionRetryManagerService,
    CriterionGradeCompilerService,
    CriterionEvidencePipelineService,
    ImageDescriptionService,
    HighlightingGeneratorService,
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
      provide: ANSWER_NORMALIZATION_SERVICE,
      useClass: AnswerNormalizationService,
    },
    {
      provide: GRADING_CACHE_SERVICE,
      useClass: GradingCacheService,
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
