/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/require-await */
// src/api/assignment/v2/common/strategies/text-grading.strategy.ts
import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { AttemptHelper } from "src/api/assignment/attempt/helper/attempts.helper";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { IGradingJudgeService } from "src/api/llm/features/grading/interfaces/grading-judge.interface";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { GRADING_JUDGE_SERVICE } from "src/api/llm/llm.constants";
import { TextBasedQuestionEvaluateModel } from "src/api/llm/model/text.based.question.evaluate.model";
import { Logger } from "winston";
import { GRADING_AUDIT_SERVICE } from "../../attempt.constants";
import { GradingAuditService } from "../../services/question-response/grading-audit.service";
import { GradingContext } from "../interfaces/grading-context.interface";
import { LocalizationService } from "../utils/localization.service";
import { AbstractGradingStrategy } from "./abstract-grading.strategy";

@Injectable()
export class TextGradingStrategy extends AbstractGradingStrategy<string> {
  protected readonly logger: Logger;

  constructor(
    protected readonly llmFacadeService: LlmFacadeService,
    protected readonly localizationService: LocalizationService,
    @Inject(GRADING_AUDIT_SERVICE)
    protected readonly gradingAuditService: GradingAuditService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
    @Optional()
    @Inject(GRADING_JUDGE_SERVICE)
    protected readonly gradingJudgeService?: IGradingJudgeService,
  ) {
    super(
      localizationService,
      gradingAuditService,
      undefined, // Don't inject consistency service to avoid DI conflicts
      gradingJudgeService,
      parentLogger,
    );
  }

  /**
   * Validate that the request contains a valid text response
   */
  async validateResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<boolean> {
    if (
      !requestDto.learnerTextResponse ||
      requestDto.learnerTextResponse.trim() === ""
    ) {
      throw new BadRequestException(
        this.localizationService.getLocalizedString(
          "expectedTextResponse",
          requestDto.language,
        ),
      );
    }
    return true;
  }

  /**
   * Extract the text response from the request
   */
  async extractLearnerResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<string> {
    return requestDto.learnerTextResponse.trim();
  }

  /**
   * Grade the text response using LLM (judge validation is handled within the LLM service)
   */
  async gradeResponse(
    question: QuestionDto,
    learnerResponse: string,
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    try {
      // Create evaluation model
      const textBasedQuestionEvaluateModel = new TextBasedQuestionEvaluateModel(
        question.question,
        context.questionAnswerContext,
        context.assignmentInstructions,
        learnerResponse,
        question.totalPoints,
        question.scoring?.type ?? "",
        question.scoring,
        question.responseType ?? "OTHER",
      );

      // Get grading from LLM (includes internal judge validation with retry logic)
      const gradingModel = await this.llmFacadeService.gradeTextBasedQuestion(
        textBasedQuestionEvaluateModel,
        context.assignmentId,
        context.language,
      );

      const responseDto = new CreateQuestionResponseAttemptResponseDto();
      AttemptHelper.assignFeedbackToResponse(gradingModel, responseDto);

      // Record grading for audit
      await this.recordGrading(
        question,
        {
          learnerTextResponse: learnerResponse,
        } as CreateQuestionResponseAttemptRequestDto,
        responseDto,
        context,
        "TextGradingStrategy",
      );

      // Add strategy metadata
      responseDto.metadata = {
        ...responseDto.metadata,
        strategyUsed: "TextGradingStrategy",
      };

      return responseDto;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error in text grading: ${errorMessage}`);
      throw new BadRequestException(
        `Failed to grade text response: ${errorMessage}`,
      );
    }
  }
}
