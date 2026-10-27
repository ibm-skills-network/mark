import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import type { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import type { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import type { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import type { GradingContext } from "src/api/attempt/common/interfaces/grading-context.interface";
import { isMediaResponseType } from "src/api/attempt/common/utils/grading-question-source.util";
import { GradingFactoryService } from "src/api/attempt/services/grading-factory.service";
import { S3Service } from "src/api/files/services/s3.service";
import { OversizedSubmissionError } from "src/api/llm/features/grading/errors/oversized-submission.error";
import { RetryableProcessingError } from "src/api/llm/features/grading/errors/source-processing.error";
import { UserRole } from "src/auth/interfaces/user.session.interface";
import { Logger } from "winston";
import type { GradingFailure } from "../v3/grading/contracts";
import type { GradingLogContext } from "../v3/grading/grade-question";
import { MaterializeLimitError } from "../v3/grading/materialize";
import { GradingModeService, type ResolvedMode } from "../v3/grading/mode";
import { V3GradingService } from "../v3/grading/v3-grading.service";
import { toLegacyResponse } from "./from-v3-result";
import { toGradingQuestion, toSubmissionSource } from "./to-v3-input";

/** A v3 grading failure in live mode; goes down the legacy failure path. */
export class V3GradingFailedError extends Error {
  constructor(readonly code: string) {
    super(`v3 grading failed (${code})`);
    this.name = "V3GradingFailedError";
  }
}

const OFF: ResolvedMode = { mode: "off", effort: "medium", source: "default" };

export interface LegacyGradeResult {
  learnerResponse: unknown;
  responseDto: CreateQuestionResponseAttemptResponseDto;
}

/**
 * The one seam between legacy grading and v3. `gradeQuestionNoSave` asks it
 * for the mode; live grades through v3 and returns the legacy shape, shadow
 * grades through v3 after legacy and only logs the comparison, off does
 * nothing.
 */
@Injectable()
export class GradingBridgeService {
  private readonly logger: Logger;

  constructor(
    private readonly modes: GradingModeService,
    private readonly grader: V3GradingService,
    private readonly gradingFactory: GradingFactoryService,
    private readonly s3Service: S3Service,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: GradingBridgeService.name });
  }

  async resolveMode(
    question: QuestionDto,
    assignmentId: number,
    role: UserRole,
  ): Promise<ResolvedMode> {
    // Author previews grade a question carried in the request: legacy only.
    if (role !== UserRole.LEARNER) return OFF;
    const resolved = await this.modes.resolve(question.type, assignmentId);
    if (resolved.mode !== "off" && isMediaResponseType(question.responseType)) {
      this.logger.info("grading.mode.format_not_ready", {
        questionId: question.id,
        assignmentId,
        responseType: question.responseType,
      });
      return { ...resolved, mode: "off" };
    }
    return resolved;
  }

  /** Validate and extract exactly as legacy does, so the stored answer matches. */
  private async extractLegacyResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<unknown> {
    let type = question.type;
    if (type === QuestionType.LINK_FILE) {
      type = requestDto.learnerUrlResponse
        ? QuestionType.URL
        : QuestionType.UPLOAD;
    }
    const strategy = this.gradingFactory.getStrategy(
      type,
      type === QuestionType.UPLOAD && question.responseType === "IMAGES"
        ? question.responseType
        : type === question.type
          ? question.responseType
          : undefined,
      requestDto.learnerFileResponse,
    );
    if (!strategy) {
      throw new BadRequestException(
        `No grading strategy found for question type: ${question.type}`,
      );
    }
    const valid = await strategy.validateResponse(question, requestDto);
    if (!valid) {
      throw new BadRequestException(
        `Invalid response for question ID ${question.id}: ${requestDto.language}`,
      );
    }
    return strategy.extractLearnerResponse(requestDto);
  }

  /** Stored upload bytes, through the same storage client legacy grading uses. */
  private readonly loadStoredFile = async (
    bucket: string,
    key: string,
  ): Promise<Buffer> => {
    try {
      const object = await this.s3Service.getObject({
        Bucket: bucket,
        Key: key,
      });
      if (!object.Body) throw new Error("No file content received from COS");
      return Buffer.from(await object.Body.transformToByteArray());
    } catch (error) {
      if (error instanceof MaterializeLimitError) throw error;
      this.logger.error("grading.v3.file_load_failed", {
        bucket,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        ?.$metadata?.httpStatusCode;
      if (status === 403 || status === 404) {
        throw new BadRequestException(
          "The uploaded file is unavailable. Upload it again.",
        );
      }
      throw new RetryableProcessingError("source_unavailable");
    }
  };

  private toError(failure: GradingFailure, context: GradingLogContext): Error {
    if (failure.code === "grading.v3.over_budget") {
      return new OversizedSubmissionError({
        blockCount: failure.estimatedTokens ?? 0,
        cap: failure.tokenBudget ?? 0,
        questionId: context.questionId,
        attemptId: context.attemptId,
      });
    }
    if (failure.retryable)
      return new RetryableProcessingError("grading_unavailable");
    return new V3GradingFailedError(failure.code);
  }

  async gradeLive(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    gradingContext: GradingContext,
    mode: ResolvedMode,
  ): Promise<LegacyGradeResult> {
    const learnerResponse = await this.extractLegacyResponse(
      question,
      requestDto,
    );
    const context: GradingLogContext = {
      questionId: question.id,
      assignmentId: gradingContext.assignmentId,
      attemptId: gradingContext.attemptId,
      mode: "live",
      questionType: question.type,
    };
    const gradingQuestion = toGradingQuestion(question, mode.effort);
    const outcome = await this.grader.grade(
      gradingQuestion,
      toSubmissionSource(question.type, learnerResponse, this.loadStoredFile),
      context,
    );
    if (outcome.status === "failed") {
      throw this.toError(outcome.failure, context);
    }
    return {
      learnerResponse,
      responseDto: toLegacyResponse(outcome.result, gradingQuestion, mode),
    };
  }

  /**
   * Shadow: legacy already graded and its result is what gets saved. Grade
   * the same stored answer with v3 and log the comparison. Never throws.
   */
  async runShadow(
    question: QuestionDto,
    legacy: LegacyGradeResult,
    gradingContext: GradingContext,
    mode: ResolvedMode,
  ): Promise<void> {
    const context: GradingLogContext = {
      questionId: question.id,
      assignmentId: gradingContext.assignmentId,
      attemptId: gradingContext.attemptId,
      mode: "shadow",
      questionType: question.type,
    };
    const started = Date.now();
    try {
      const gradingQuestion = toGradingQuestion(question, mode.effort);
      const outcome = await this.grader.grade(
        gradingQuestion,
        toSubmissionSource(
          question.type,
          legacy.learnerResponse,
          this.loadStoredFile,
        ),
        context,
      );
      const legacyPoints = legacy.responseDto.totalPoints ?? null;
      const v3Points =
        outcome.status === "graded" ? outcome.result.totalPoints : null;
      this.logger.info("grading.v3.shadow_compare", {
        ...context,
        effort: mode.effort,
        maxPoints: question.totalPoints,
        legacyPoints,
        v3Status: outcome.status,
        v3Points,
        v3FailureCode:
          outcome.status === "failed" ? outcome.failure.code : undefined,
        delta:
          legacyPoints !== null && v3Points !== null
            ? Math.round((v3Points - legacyPoints) * 100) / 100
            : null,
        usage:
          outcome.status === "graded"
            ? outcome.result.usage
            : outcome.failure.usage,
        checkFailureCount:
          outcome.status === "graded"
            ? outcome.result.checkFailures.length
            : outcome.failure.checkFailures.length,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      // Shadow must never affect the saved grade; record and move on.
      this.logger.error("grading.v3.shadow_failed", {
        ...context,
        errorClass: error instanceof Error ? error.name : typeof error,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        durationMs: Date.now() - started,
      });
    }
  }
}
