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
  GradingIssueCode,
  GradingIssueDetails,
  sanitizeIssueUrl,
} from "src/api/llm/features/grading/errors/grading-failure";
import {
  detectPrefetchUrlIssue,
  isCourseTemplateRepoUrl,
} from "../utils/learner-url-issues.util";
import {
  expectedHostsForResponseType,
  normalizeLearnerUrl,
  validateLearnerUrl,
} from "../utils/learner-url.util";
import { LocalizationService } from "../utils/localization.service";
import { AbstractGradingStrategy } from "./abstract-grading.strategy";

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    // Log context only: an unparseable answer has no host.
    return undefined;
  }
}

@Injectable()
export class UrlGradingStrategy extends AbstractGradingStrategy<string> {
  readonly supportsSourceCheck = true;

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

      // URL *format* validity is intentionally NOT a hard gate here: a
      // BadRequestException at this point is treated as a system failure.
      // An unparseable URL is reported by gradeResponse instead, as an
      // "unable to grade" issue the learner can fix and resubmit, alongside
      // any other blocked questions in the attempt. Presence/type is still
      // enforced above.
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
    const { targetUrl, urlFetchResponse } = await this.loadGradeableSource(
      question,
      learnerResponse,
      context,
    );

    if (context.sourceCheckOnly) {
      // Another question in this attempt is already blocked, so nothing will
      // be saved: the link was readable, which is all this pass needed.
      return this.createResponseDto(0, []);
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

  /**
   * Everything that has to hold before a link is worth sending to the grader:
   * it reads as a URL, it is not a placeholder or a non-content page, and the
   * fetch returned something. Each failure blocks the question with the code
   * the learner needs to fix it.
   */
  private async loadGradeableSource(
    question: QuestionDto,
    learnerResponse: string,
    context: GradingContext,
  ): Promise<{ targetUrl: string; urlFetchResponse: GithubFetchResult }> {
    const urlValidation = validateLearnerUrl(learnerResponse, {
      expectedHosts: expectedHostsForResponseType(question.responseType),
    });
    if (!urlValidation.isValid) {
      this.blockSource(question, context, "url_fetch_failed", {
        code: "url_invalid",
        source: { kind: "url", url: learnerResponse },
      });
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
    const prefetchIssue = detectPrefetchUrlIssue(targetUrl);
    if (prefetchIssue) {
      this.blockSource(question, context, "url_fetch_failed", {
        code: prefetchIssue.code,
        source: { kind: "url", url: targetUrl },
      });
    }

    let urlFetchResponse: GithubFetchResult;
    try {
      urlFetchResponse = await fetchUrlContentForGrading(targetUrl, {
        assignmentId: context.assignmentId,
        questionId: question.id,
      });
    } catch (error) {
      if (error instanceof RetryableUrlFetchError) {
        error.questionId = question.id;
        error.learnerUrl = targetUrl;
        this.logger?.warn(
          "Transient failure fetching a learner URL for grading; propagating as retryable",
          {
            assignmentId: context.assignmentId,
            attemptId: context.attemptId,
            questionId: question.id,
            host: hostOf(targetUrl),
            reason: error.reason,
            status: error.status,
          },
        );
        throw error;
      }
      this.logger?.error("grading.source_processing.blocked", {
        assignmentId: context.assignmentId,
        attemptId: context.attemptId,
        questionId: question.id,
        reason: "source_unavailable",
        sourceReference: "url",
        retryable: true,
        scoringBlocked: true,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new RetryableProcessingError("source_unavailable", "url");
    }

    const hasBody =
      typeof urlFetchResponse.body === "string"
        ? urlFetchResponse.body.trim().length > 0
        : urlFetchResponse.body != null;
    if (!urlFetchResponse.isFunctional || !hasBody) {
      let code: GradingIssueCode =
        urlFetchResponse.failure?.code ??
        (urlFetchResponse.isFunctional ? "url_empty" : "url_unreachable");
      if (
        (code === "url_unreachable" || code === "url_empty") &&
        isCourseTemplateRepoUrl(targetUrl)
      ) {
        code = "url_template_repo";
      }
      this.blockSource(question, context, "url_fetch_failed", {
        code,
        source: {
          kind: "url",
          url: targetUrl,
          httpStatus: urlFetchResponse.failure?.httpStatus,
        },
      });
    }

    if (question.responseType === "REPO" && urlFetchResponse.evidenceKind) {
      const url = sanitizeIssueUrl(targetUrl) ?? "your repository link";
      this.blockSource(question, context, "insufficient_source_evidence", {
        code: "source_unreadable",
        source: { kind: "url", url: targetUrl },
        message: `We could only read the README or description of ${url}, which isn't enough to grade this question. Link to the specific files or folder that contain your work, then submit again.`,
      });
    }

    return { targetUrl, urlFetchResponse };
  }

  private blockSource(
    question: QuestionDto,
    context: GradingContext,
    reason: "url_fetch_failed" | "insufficient_source_evidence",
    details: GradingIssueDetails,
  ): never {
    const error = new SourceProcessingError(reason, "url", {
      ...details,
      questionId: question.id,
    });
    this.logger?.warn("grading.source_processing.blocked", {
      assignmentId: context.assignmentId,
      attemptId: context.attemptId,
      questionId: question.id,
      reason,
      code: details.code,
      host: hostOf(details.source?.url),
      httpStatus: details.source?.httpStatus,
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
