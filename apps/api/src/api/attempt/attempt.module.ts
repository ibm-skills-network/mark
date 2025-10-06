import { Module } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { AssignmentAttemptAccessControlGuard } from "../assignment/attempt/guards/assignment.attempt.access.control.guard";
import { QuestionService } from "../assignment/question/question.service";
import { AssignmentModuleV2 } from "../assignment/v2/modules/assignment.module";
import { AssignmentRepository } from "../assignment/v2/repositories/assignment.repository";
import { GradingConsistencyService } from "../assignment/v2/services/grading-consistency.service";
import { S3Service } from "../files/services/s3.service";
import { ImageGradingService } from "../llm/features/grading/services/image-grading.service";
import { LlmModule } from "../llm/llm.module";
import {
  FILE_CONTENT_EXTRACTION_SERVICE,
  GRADING_AUDIT_SERVICE,
} from "./attempt.constants";
import { AttemptControllerV2 } from "./attempt.controller";
import { ChoiceGradingStrategy } from "./common/strategies/choice-grading.strategy";
import { FileGradingStrategy } from "./common/strategies/file-grading.strategy";
import { ImageGradingStrategy } from "./common/strategies/image-grading.strategy";
import { PresentationGradingStrategy } from "./common/strategies/presentation-grading.strategy";
import { TextGradingStrategy } from "./common/strategies/text-grading.strategy";
import { TrueFalseGradingStrategy } from "./common/strategies/true-false-grading.strategy";
import { UrlGradingStrategy } from "./common/strategies/url-grading.strategy";
import { LocalizationService } from "./common/utils/localization.service";
import { AttemptFeedbackService } from "./services/attempt-feedback.service";
import { AttemptGradingService } from "./services/attempt-grading.service";
import { AttemptRegradingService } from "./services/attempt-regrading.service";
import { AttemptReportingService } from "./services/attempt-reporting.service";
import { AttemptSubmissionService } from "./services/attempt-submission.service";
import { AttemptValidationService } from "./services/attempt-validation.service";
import { AttemptServiceV2 } from "./services/attempt.service";
import { FileContentExtractionService } from "./services/file-content-extraction";
import { GradingFactoryService } from "./services/grading-factory.service";
import { GradingAuditService } from "./services/question-response/grading-audit.service";
import { QuestionResponseService } from "./services/question-response/question-response.service";
import { QuestionVariantService } from "./services/question-variant/question-variant.service";
import { TranslationService } from "./services/translation/translation.service";

@Module({
  imports: [LlmModule, AssignmentModuleV2],
  controllers: [AttemptControllerV2],
  providers: [
    AttemptServiceV2,
    AttemptSubmissionService,
    AttemptValidationService,
    AttemptGradingService,
    AttemptFeedbackService,
    AttemptRegradingService,
    AttemptReportingService,
    TranslationService,
    QuestionService,
    GradingFactoryService,
    TextGradingStrategy,
    FileGradingStrategy,
    UrlGradingStrategy,
    PresentationGradingStrategy,
    ChoiceGradingStrategy,
    TrueFalseGradingStrategy,
    GradingConsistencyService,
    {
      provide: GRADING_AUDIT_SERVICE,
      useClass: GradingAuditService,
    },
    PrismaService,
    {
      provide: FILE_CONTENT_EXTRACTION_SERVICE,
      useClass: FileContentExtractionService,
    },
    ImageGradingStrategy,
    ImageGradingService,
    S3Service,
    AssignmentRepository,
    QuestionResponseService,

    QuestionVariantService,
    LocalizationService,

    AssignmentAttemptAccessControlGuard,
  ],
  exports: [
    AttemptServiceV2,
    AttemptSubmissionService,
    AttemptValidationService,
    AttemptGradingService,
    AttemptFeedbackService,
    AttemptRegradingService,
    AttemptReportingService,
    QuestionResponseService,
  ],
})
export class AttemptModule {}
