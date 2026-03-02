/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/require-await */
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
import { GradingConsistencyService } from "src/api/assignment/v2/services/grading-consistency.service";
import { IGradingJudgeService } from "src/api/llm/features/grading/interfaces/grading-judge.interface";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { GRADING_JUDGE_SERVICE } from "src/api/llm/llm.constants";
import { TextBasedQuestionEvaluateModel } from "src/api/llm/model/text.based.question.evaluate.model";
import { Logger } from "winston";
import {
  GRADING_AUDIT_SERVICE,
  GRADING_CONSISTENCY_SERVICE,
} from "../../attempt.constants";
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
    @Optional()
    @Inject(GRADING_CONSISTENCY_SERVICE)
    protected readonly consistencyService: GradingConsistencyService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
    @Optional()
    @Inject(GRADING_JUDGE_SERVICE)
    protected readonly gradingJudgeService?: IGradingJudgeService,
  ) {
    super(
      localizationService,
      gradingAuditService,
      consistencyService,
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
    const textResponse =
      typeof requestDto.learnerTextResponse === "string"
        ? requestDto.learnerTextResponse.trim()
        : "";

    if (!textResponse) {
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
    if (typeof requestDto.learnerTextResponse !== "string") {
      throw new BadRequestException("Text response must be a string");
    }
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
      const reuseDto = await this.tryReuseFromConsistency(
        question,
        learnerResponse,
        context,
      );
      if (reuseDto) {
        return reuseDto;
      }

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

      const gradingModel = await this.llmFacadeService.gradeTextBasedQuestion(
        textBasedQuestionEvaluateModel,
        context.assignmentId,
        context.language,
      );

      const responseDto = new CreateQuestionResponseAttemptResponseDto();
      AttemptHelper.assignFeedbackToResponse(gradingModel, responseDto);
      this.appendRationale(
        responseDto,
        gradingModel.points,
        question.totalPoints,
        gradingModel,
      );

      await this.recordGrading(
        question,
        {
          learnerTextResponse: learnerResponse,
        } as CreateQuestionResponseAttemptRequestDto,
        responseDto,
        context,
        "TextGradingStrategy",
      );

      responseDto.metadata = {
        ...responseDto.metadata,
        ...gradingModel.metadata,
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

  /**
   * Attempt to reuse a previous grading when the learner response hash matches.
   */
  private async tryReuseFromConsistency(
    question: QuestionDto,
    learnerResponse: string,
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto | null> {
    void context;
    if (!this.consistencyService) {
      return null;
    }

    try {
      const responseHash = this.consistencyService.generateResponseHash(
        learnerResponse,
        question.id,
        question.type,
      );

      const check = await this.consistencyService.checkConsistency(
        question.id,
        responseHash,
        learnerResponse,
        question.type,
      );

      if (check.similar && check.previousGrade !== undefined) {
        const responseDto = new CreateQuestionResponseAttemptResponseDto();
        responseDto.totalPoints = this.sanitizePoints(check.previousGrade);

        const feedbackText =
          typeof check.previousFeedback === "string"
            ? check.previousFeedback
            : "Reused prior grading result for identical answer.";

        responseDto.feedback = [
          {
            feedback: `${feedbackText}\n\n**Score Rationale:** Reused prior grade (${responseDto.totalPoints}/${question.totalPoints}).`,
          },
        ];
        responseDto.metadata = {
          ...responseDto.metadata,
          reusedPriorGrade: true,
          responseHash,
          maxPossiblePoints: question.totalPoints,
        };
        return responseDto;
      }
    } catch (error) {
      this.logger.warn("Consistency reuse failed - proceeding to grade", {
        error: error instanceof Error ? error.message : String(error),
        questionId: question.id,
      });
    }

    return null;
  }

  /**
   * Attach a short rationale explaining the awarded score.
   */
  private appendRationale(
    responseDto: CreateQuestionResponseAttemptResponseDto,
    awardedPoints: number,
    maxPoints: number,
    gradingModel: {
      analysis?: string;
      evaluation?: string;
      explanation?: string;
      guidance?: string;
    },
  ): void {
    if (!responseDto?.feedback?.length) {
      return;
    }

    const rationalePieces = [
      gradingModel?.evaluation,
      gradingModel?.explanation,
      gradingModel?.analysis,
    ]
      .filter(Boolean)
      .map(String);

    const rationaleText =
      `**Score Rationale:** Awarded ${awardedPoints}/${maxPoints} points.` +
      (rationalePieces.length > 0
        ? ` ${rationalePieces.join(" ")}`
        : " See rubric feedback above.");

    const firstFeedback = responseDto.feedback[0] as { feedback?: string };
    firstFeedback.feedback = `${
      firstFeedback.feedback || ""
    }\n\n${rationaleText}`.trim();

    responseDto.metadata = {
      ...responseDto.metadata,
      rationale: rationaleText,
    };
  }
}
