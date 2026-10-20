import {
  SourceProcessingError,
  RetryableProcessingError,
} from "../../../llm/features/grading/errors/source-processing.error";
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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
import {
  fetchUrlContentForGrading,
  GithubFetchResult,
} from "src/api/attempt/common/utils/github-content-fetch.util";
import { RetryableUrlFetchError } from "src/api/llm/features/grading/errors/retryable-url-fetch.error";
import { hashSafetyIdentifier } from "src/api/llm/core/utils/safety-identifier.util";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { UrlBasedQuestionEvaluateModel } from "src/api/llm/model/url.based.question.evaluate.model";
import { UrlBasedQuestionResponseModel } from "src/api/llm/model/url.based.question.response.model";
import { Logger } from "winston";
import { GRADING_AUDIT_SERVICE } from "../../attempt.constants";
import { GradingAuditService } from "../../services/question-response/grading-audit.service";
import { GradingContext } from "../interfaces/grading-context.interface";
import {
  expectedHostsForResponseType,
  normalizeLearnerUrl,
  validateLearnerUrl,
} from "../utils/learner-url.util";
import { LocalizationService } from "../utils/localization.service";
import { AbstractGradingStrategy } from "./abstract-grading.strategy";

@Injectable()
export class UrlGradingStrategy extends AbstractGradingStrategy<string> {
  constructor(
    private readonly llmFacadeService: LlmFacadeService,
    protected readonly localizationService: LocalizationService,
    @Inject(GRADING_AUDIT_SERVICE)
    protected readonly gradingAuditService: GradingAuditService,
    @Optional() @Inject(WINSTON_MODULE_PROVIDER) parentLogger?: Logger,
  ) {
    super(
      localizationService,
      gradingAuditService,
      undefined,
      undefined,
      parentLogger,
    );
  }

  /**
   * Validate that the request contains a valid URL
   */
  async validateResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<boolean> {
    try {
      const urlResponse =
        typeof requestDto.learnerUrlResponse === "string"
          ? requestDto.learnerUrlResponse.trim()
          : "";

      if (!urlResponse) {
        throw new BadRequestException(
          this.localizationService?.getLocalizedString?.(
            "expectedUrlResponse",
            requestDto.language,
          ) || "Expected a URL response, but did not receive one.",
        );
      }

      // URL *format* validity is intentionally NOT a hard gate here. Throwing
      // at validation time fails the entire grading job and leaves the
      // learner's attempt ungraded (observed in prod: "Failed to process
      // question response: Invalid URL: script.js"). An unparseable URL is
      // instead graded 0-with-feedback in gradeResponse (see the invalid-URL
      // guard there), so the learner still gets a score + feedback and LMS
      // sync proceeds. Presence/type is still enforced above.
      return true;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        "URL validation failed due to system error",
      );
    }
  }

  /**
   * Extract the URL response from the request
   */
  async extractLearnerResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<string> {
    if (typeof requestDto.learnerUrlResponse !== "string") {
      throw new BadRequestException("URL response must be a string");
    }
    // Normalize here rather than at the browser: a pasted trailing space or a
    // missing scheme must not change the outcome, and the request body is not
    // trusted. A value that cannot be normalized is passed through unchanged
    // so gradeResponse can quote it back to the learner.
    const raw = requestDto.learnerUrlResponse.trim();
    return normalizeLearnerUrl(raw) || raw;
  }

  /**
   * Grade the URL response using LLM
   */
  async gradeResponse(
    question: QuestionDto,
    learnerResponse: string,
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    // Guard: an unparseable URL is a learner input error, not a system
    // failure. Grade it 0 with feedback and skip the fetch/LLM path entirely
    // (unlike a source processing failure). validateResponse lets
    // invalid formats through on purpose so they are graded here rather than
    // failing the job.
    const urlValidation = validateLearnerUrl(learnerResponse, {
      expectedHosts: expectedHostsForResponseType(question.responseType),
    });
    if (!urlValidation.isValid) {
      const responseDto = this.createResponseDto(0, [
        {
          feedback:
            this.localizationService?.getLocalizedString?.(
              "invalidUrl",
              context.language,
              { url: learnerResponse },
            ) || `Invalid URL: ${learnerResponse}`,
        },
      ]);

      responseDto.metadata = {
        error: "invalid_url",
        url: learnerResponse,
        status: "error",
        maxPossiblePoints: question.totalPoints,
      };

      await this.recordGrading(
        question,
        {
          learnerUrlResponse: learnerResponse,
        } as CreateQuestionResponseAttemptRequestDto,
        responseDto,
        context,
        "UrlGradingStrategy-InvalidUrl",
      );

      return responseDto;
    }

    if (urlValidation.isUnexpectedHost) {
      // Advisory only — never changes the score. Surfaces authoring drift
      // (a repository question collecting links somewhere else) without
      // inventing a rejection the learner cannot argue with.
      this.logger?.info("Learner URL is not on the question's expected hosts", {
        assignmentId: context.assignmentId,
        questionId: question.id,
        responseType: question.responseType,
      });
    }

    const targetUrl = urlValidation.normalizedUrl;
    let urlFetchResponse: GithubFetchResult;

    try {
      urlFetchResponse = await fetchUrlContentForGrading(targetUrl, {
        assignmentId: context.assignmentId,
        questionId: question.id,
      });
    } catch (error) {
      if (error instanceof RetryableUrlFetchError) {
        this.logger?.warn(
          "Transient failure fetching a learner URL for grading; propagating as retryable",
          {
            assignmentId: context.assignmentId,
            questionId: question.id,
            reason: error.reason,
            status: error.status,
          },
        );
        throw error;
      }
      this.logger?.warn("grading.source_processing.blocked", {
        assignmentId: context.assignmentId,
        attemptId: context.attemptId,
        questionId: question.id,
        reason: "source_unavailable",
        sourceReference: "url",
        retryable: true,
        scoringBlocked: true,
      });
      throw new RetryableProcessingError("source_unavailable", "url");
    }

    if (
      !urlFetchResponse.isFunctional ||
      (typeof urlFetchResponse.body === "string"
        ? !urlFetchResponse.body.trim()
        : urlFetchResponse.body == null)
    ) {
      this.blockSource(question, context, "url_fetch_failed");
    }

    if (question.responseType === "REPO" && urlFetchResponse.evidenceKind) {
      this.blockSource(question, context, "insufficient_source_evidence");
    }

    const urlBody =
      typeof urlFetchResponse.body === "string"
        ? urlFetchResponse.body
        : JSON.stringify(urlFetchResponse.body);
    const urlBasedQuestionEvaluateModel = new UrlBasedQuestionEvaluateModel(
      question.question,
      context.questionAnswerContext,
      context.assignmentInstructions,
      // The URL that was actually fetched, so the model never reasons about a
      // scheme the learner happened to leave off.
      targetUrl,
      urlFetchResponse.isFunctional,
      urlBody,
      question.totalPoints,
      question.scoring?.type ?? "",
      question.scoring,
      question.responseType ?? "OTHER",
    );
    urlBasedQuestionEvaluateModel.safetyIdentifier = context.userId
      ? hashSafetyIdentifier(context.userId)
      : undefined;

    let gradingModel: UrlBasedQuestionResponseModel;
    try {
      gradingModel = await this.llmFacadeService.gradeUrlBasedQuestion(
        urlBasedQuestionEvaluateModel,
        context.assignmentId,
        context.language,
      );
    } catch (error) {
      this.logger?.warn("grading.provider.blocked", {
        assignmentId: context.assignmentId,
        attemptId: context.attemptId,
        questionId: question.id,
        scoringBlocked: true,
      });
      if (error instanceof RetryableProcessingError) throw error;
      throw new RetryableProcessingError("grading_unavailable");
    }

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(gradingModel, responseDto);

    responseDto.metadata = {
      ...responseDto.metadata,
      url: learnerResponse,
      contentSummary: this.summarizeContent(urlBody),
      contentLength: urlBody.length,
      isGithubRepo: targetUrl.includes("github.com"),
      gradingRationale:
        gradingModel.gradingRationale || "URL content evaluated",
      maxPossiblePoints: question.totalPoints,
    };

    await this.recordGrading(
      question,
      {
        learnerUrlResponse: learnerResponse,
      } as CreateQuestionResponseAttemptRequestDto,
      responseDto,
      context,
      "UrlGradingStrategy-Success",
    );

    return responseDto;
  }

  private blockSource(
    question: QuestionDto,
    context: GradingContext,
    reason: "url_fetch_failed" | "insufficient_source_evidence",
  ): never {
    const error = new SourceProcessingError(reason, "url");
    this.logger?.warn("grading.source_processing.blocked", {
      assignmentId: context.assignmentId,
      attemptId: context.attemptId,
      questionId: question.id,
      reason,
      sourceReference: error.sourceReference,
      retryable: error.retryable,
      scoringBlocked: true,
    });
    throw error;
  }

  /**
   * Create a brief summary of the URL content
   */
  private summarizeContent(content: string): string {
    if (!content) return "No content available";

    const preview = content.slice(0, 150).trim();

    return content.length > 150 ? `${preview}...` : preview;
  }
}
