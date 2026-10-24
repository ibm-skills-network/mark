import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBody,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from "@nestjs/swagger";
import { ReportType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Observable } from "rxjs";
import {
  UserRole,
  UserSessionRequest,
} from "src/auth/interfaces/user.session.interface";
import { Roles } from "src/auth/role/roles.global.guard";
import { DataTransform } from "src/common/interceptors/data-transform.interceptor";
import { normalizeLangQuery } from "src/helpers/query-language";
import { AttemptTier } from "src/job-queue/attempt-tier";
import { Logger } from "winston";
import {
  GRADE_SUBMISSION_EXCEPTION,
  IN_COOLDOWN_PERIOD,
  MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
  SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
} from "../assignment/attempt/api-exceptions/exceptions";
import { BaseAssignmentAttemptResponseDto } from "../assignment/attempt/dto/assignment-attempt/base.assignment.attempt.response.dto";
import { LearnerUpdateAssignmentAttemptRequestDto } from "../assignment/attempt/dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import {
  AssignmentFeedbackDto,
  AssignmentFeedbackResponseDto,
  RegradingRequestDto,
  RegradingStatusResponseDto,
  RequestRegradingResponseDto,
} from "../assignment/attempt/dto/assignment-attempt/feedback.request.dto";
import { SubmitAssignmentAttemptResponseDto } from "../assignment/attempt/dto/assignment-attempt/submit.assignment.attempt.response.dto";
import { ReportRequestDTO } from "../assignment/attempt/dto/assignment-attempt/post.assignment.report.dto";
import { AssignmentAttemptAccessControlGuard } from "../assignment/attempt/guards/assignment.attempt.access.control.guard";
import { TRANSFORM_FIELDS } from "../../helpers/transform-config";
import { GRADING_AUDIT_SERVICE } from "./attempt.constants";
import { CompletedAttemptResponseDto } from "./dto/completed-attempt.response.dto";
import {
  AttemptSummaryResponseDto,
  LearnerAttemptResponseDto,
} from "./dto/learner-attempt.response.dto";
import { AttemptServiceV2 } from "./services/attempt.service";
import { GradingProgressService } from "./services/grading-progress.service";
import { GradingAuditService } from "./services/question-response/grading-audit.service";
import { LtiGradeSyncService } from "./services/lti-grade-sync.service";
import { GradingKillSwitchService } from "../ai-feature-flags/grading-kill-switch.service";

@ApiTags("Attempts")
@Injectable()
@Controller({
  path: "assignments/:assignmentId/attempts",
  version: "2",
})
export class AttemptControllerV2 {
  private logger: Logger;
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private parentLogger: Logger,
    private readonly attemptService: AttemptServiceV2,
    @Inject(GRADING_AUDIT_SERVICE)
    private readonly gradingAuditService: GradingAuditService,
    @Inject("GradingProgressService")
    private readonly gradingProgressService: GradingProgressService,
    private readonly ltiGradeSyncService: LtiGradeSyncService,
    private readonly gradingKillSwitch: GradingKillSwitchService,
  ) {
    this.logger = parentLogger.child({ context: AttemptControllerV2.name });
  }

  @Post()
  @Roles(UserRole.LEARNER)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @DataTransform({ encodeResponse: false })
  @ApiOperation({
    summary: "Create an assignment attempt for an assignment.",
  })
  @ApiResponse({ status: 201, type: BaseAssignmentAttemptResponseDto })
  @ApiResponse({
    status: 422,
    type: String,
    description: MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
  })
  @ApiResponse({
    status: 429,
    type: String,
    description: IN_COOLDOWN_PERIOD,
  })
  @ApiResponse({ status: 403 })
  createAssignmentAttempt(
    @Param("assignmentId") assignmentId: number,
    @Req() request: UserSessionRequest,
  ): Promise<BaseAssignmentAttemptResponseDto> {
    return this.attemptService.createAssignmentAttempt(
      Number(assignmentId),
      request.userSession,
    );
  }

  @Post(":attemptId/abandon")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @DataTransform({ encodeResponse: false })
  @ApiOperation({
    summary:
      "Abandon an in-progress attempt that is pinned to a stale assignment version.",
    description:
      "Only valid when the attempt has zero responses AND the assignment has been republished since the attempt began. Hard-deletes the attempt so the learner can create a fresh one against the current version.",
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404 })
  @ApiResponse({
    status: 422,
    type: String,
    description:
      "Attempt has responses, has been submitted, or is already pinned to the current version.",
  })
  abandonAssignmentAttempt(
    @Param("attemptId") assignmentAttemptId: number,
    @Req() request: UserSessionRequest,
  ): Promise<{ id: number; success: true }> {
    return this.attemptService.abandonAssignmentAttempt(
      Number(assignmentAttemptId),
      request.userSession,
    );
  }

  @Get()
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @DataTransform({ encodeResponse: false })
  @ApiOperation({ summary: "List assignment attempts for an assignment." })
  @ApiResponse({ status: 200, type: [AttemptSummaryResponseDto] })
  @ApiResponse({ status: 403 })
  @ApiResponse({
    status: 422,
    type: String,
    description: MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
  })
  @ApiResponse({
    status: 429,
    type: String,
    description: IN_COOLDOWN_PERIOD,
  })
  @ApiResponse({
    status: 500,
    type: String,
    description: GRADE_SUBMISSION_EXCEPTION,
  })
  listAssignmentAttempts(
    @Param("assignmentId") assignmentId: number,
    @Req() request: UserSessionRequest,
  ): Promise<AttemptSummaryResponseDto[]> {
    return this.attemptService.listAssignmentAttempts(
      Number(assignmentId),
      request.userSession,
    );
  }

  @Get(":attemptId")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @DataTransform({ encodeResponse: false })
  @ApiOperation({ summary: "Get an assignment attempt for an assignment." })
  @ApiResponse({ status: 200, type: LearnerAttemptResponseDto })
  @ApiResponse({ status: 403 })
  getAssignmentAttempt(
    @Param("attemptId") assignmentAttemptId: number,
    @Req() request: UserSessionRequest,
    @Query("lang") lang?: unknown,
  ): Promise<LearnerAttemptResponseDto> {
    return this.attemptService.getAssignmentAttempt(
      Number(assignmentAttemptId),
      request.userSession,
      normalizeLangQuery(lang),
    );
  }

  @Get(":attemptId/completed")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @DataTransform({ encodeResponse: false })
  @ApiOperation({ summary: "Get a submitted attempt for its results page." })
  @ApiResponse({ status: 200, type: CompletedAttemptResponseDto })
  @ApiResponse({ status: 403 })
  @ApiResponse({ status: 404, description: "Missing, not owned, or open." })
  getLearnerAssignmentAttempt(
    @Param("assignmentId") assignmentId: string,
    @Param("attemptId") assignmentAttemptId: string,
    @Req() request: UserSessionRequest,
  ): Promise<CompletedAttemptResponseDto> {
    // The guard has already parsed both ids strictly.
    return this.attemptService.getLearnerAssignmentAttempt(
      Number(assignmentAttemptId),
      Number(assignmentId),
      request.userSession,
    );
  }

  @Patch(":attemptId")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  // The web client still base64-encodes answer text, so requests keep being
  // decoded; the result goes out as plain JSON.
  @DataTransform({
    encodeResponse: false,
    decodeRequest: true,
    fields: [...TRANSFORM_FIELDS],
    deep: true,
  })
  @ApiExtraModels(SubmitAssignmentAttemptResponseDto)
  @ApiOperation({
    summary: "Update an assignment attempt for an assignment.",
  })
  @ApiBody({
    type: LearnerUpdateAssignmentAttemptRequestDto,
    required: true,
  })
  @ApiResponse({
    status: 200,
    description:
      "Queued: {gradingJobId, message}; follow the SSE stream. Graded in the request: the submit result.",
    schema: {
      oneOf: [
        {
          type: "object",
          properties: {
            gradingJobId: {
              type: "string",
              description: "Job ID for tracking grading progress",
            },
            message: { type: "string", description: "Status message" },
          },
        },
        { $ref: getSchemaPath(SubmitAssignmentAttemptResponseDto) },
      ],
    },
  })
  @ApiResponse({
    status: 400,
    description:
      "Invalid payload, unserved or duplicate question ids, a file that is not the learner's upload, or an answer to an unsupported question type (code UNSUPPORTED_RESPONSE_TYPE).",
  })
  @ApiResponse({
    status: 422,
    type: String,
    description: SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
  })
  @ApiResponse({
    status: 429,
    type: String,
    description: IN_COOLDOWN_PERIOD,
  })
  @ApiResponse({
    status: 500,
    type: String,
    description: GRADE_SUBMISSION_EXCEPTION,
  })
  @ApiResponse({
    status: 409,
    description:
      "The attempt is already submitted or was closed at its time limit; the body carries a code saying which.",
  })
  @ApiResponse({ status: 403 })
  async updateAssignmentAttempt(
    @Param("attemptId") attemptId: number,
    @Param("assignmentId") assignmentId: number,
    @Body()
    learnerUpdateAssignmentAttemptDto: LearnerUpdateAssignmentAttemptRequestDto,
    @Req() request: UserSessionRequest,
  ): Promise<
    | { gradingJobId: string; message: string }
    | SubmitAssignmentAttemptResponseDto
  > {
    // Taken first: the deadline is judged on arrival, so nothing this handler
    // or the grading queue does afterwards can make an on-time submit late.
    const receivedAt = new Date();
    const parsedAttemptId = Number(attemptId);
    const parsedAssignmentId = Number(assignmentId);

    this.logger.info(
      `Updating attempt: attemptId=${parsedAttemptId}, assignmentId=${parsedAssignmentId}`,
    );

    const isAuthorMode = request.userSession.role === UserRole.AUTHOR;

    // A closed or past-deadline attempt gets its 409 here, synchronously,
    // before the kill-switch (a closed attempt is closed whether or not AI
    // grading is paused) and before a grading job could be queued for it.
    if (!isAuthorMode) {
      let inFlightGradingJobId: string | null;
      try {
        ({ inFlightGradingJobId } =
          await this.attemptService.assertLearnerAttemptOpenForSubmit(
            parsedAttemptId,
            parsedAssignmentId,
            request.userSession.userId,
            receivedAt,
          ));
      } catch (error) {
        this.logger.warn("Submit rejected before grading", {
          attemptId: parsedAttemptId,
          assignmentId: parsedAssignmentId,
          userId: request.userSession.userId,
          reason: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      // A duplicate submit (retry, second tab) while the accepted one is still
      // grading gets that job back; its own payload is never queued.
      if (inFlightGradingJobId) {
        this.logger.info("Submit reused in-flight grading job", {
          attemptId: parsedAttemptId,
          assignmentId: parsedAssignmentId,
          userId: request.userSession.userId,
          gradingJobId: inFlightGradingJobId,
        });
        return {
          gradingJobId: inFlightGradingJobId,
          message:
            "A grading job is already running for this attempt. Reusing existing job.",
        };
      }

      // A payload grading would refuse is refused here, before it is queued,
      // so the learner gets the 400/422 on this request rather than a failed
      // grading job. The refusal itself is logged where it is decided.
      await this.attemptService.assertSubmitPayloadAcceptable(
        parsedAttemptId,
        parsedAssignmentId,
        request.userSession.userId,
        learnerUpdateAssignmentAttemptDto,
      );
    }

    // Kill-switch: block submitting/grading an AI-graded attempt while grading
    // is disabled. Throwing here means the attempt is neither marked submitted
    // nor enqueued for grading, so the learner's progress is preserved and no
    // LLM call is made. Non-AI assignments pass through untouched.
    await this.gradingKillSwitch.assertGradingAllowed(
      parsedAssignmentId,
      request.userSession?.userId,
      "submit",
    );

    const authCookie: string =
      typeof request?.cookies?.authentication === "string"
        ? request.cookies.authentication
        : "";
    const gradingCallbackRequired =
      request?.userSession.gradingCallbackRequired ?? false;

    // Deterministic-only learner attempts grade synchronously in-request —
    // no queue, no SSE. Author previews always queue (the sync path is the
    // learner pipeline), and any classification gap degrades to the queued
    // path, never the other way.
    const attemptTier: AttemptTier | null = isAuthorMode
      ? null
      : await this.attemptService.classifyLearnerAttemptTier(parsedAttemptId);
    const needsLongRunningGrading = attemptTier !== "inline";

    if (needsLongRunningGrading && !isAuthorMode) {
      const queuedTier = attemptTier === "heavy" ? "heavy" : "standard";
      const { gradingJobId, message, queueName } =
        await this.attemptService.createGradingJob(
          parsedAttemptId,
          parsedAssignmentId,
          learnerUpdateAssignmentAttemptDto,
          authCookie,
          request,
          queuedTier,
        );

      await this.attemptService.enqueueGradingJob(
        gradingJobId,
        parsedAttemptId,
        parsedAssignmentId,
        learnerUpdateAssignmentAttemptDto,
        authCookie,
        request,
        queueName,
        receivedAt,
      );

      return { gradingJobId, message };
    } else if (needsLongRunningGrading && isAuthorMode) {
      const { gradingJobId, message, queueName } =
        await this.attemptService.createAuthorGradingJob(
          parsedAssignmentId,
          learnerUpdateAssignmentAttemptDto,
          authCookie,
          request,
        );

      await this.attemptService.enqueueAuthorPreviewJob(
        gradingJobId,
        parsedAssignmentId,
        learnerUpdateAssignmentAttemptDto,
        authCookie,
        request,
        queueName,
      );

      return { gradingJobId, message };
    } else {
      const result = await this.attemptService.updateAssignmentAttempt(
        parsedAttemptId,
        parsedAssignmentId,
        learnerUpdateAssignmentAttemptDto,
        authCookie,
        gradingCallbackRequired,
        request,
        receivedAt,
      );
      return result;
    }
  }

  @Get(":attemptId/grading/:gradingJobId/status-stream")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @ApiOperation({ summary: "Stream grading job status" })
  @ApiParam({ name: "attemptId", required: true, description: "Attempt ID" })
  @ApiParam({
    name: "gradingJobId",
    required: true,
    description: "Grading Job ID",
  })
  @Sse()
  async streamGradingStatus(
    @Param("attemptId") attemptId: number,
    @Param("gradingJobId") gradingJobId: string,
    @Req() request: UserSessionRequest,
  ): Promise<Observable<MessageEvent>> {
    const job = await this.attemptService.getGradingJob(gradingJobId);

    if (!job) {
      throw new NotFoundException(
        `Grading job with ID ${gradingJobId} not found`,
      );
    }

    if (job.userId !== request.userSession.userId) {
      throw new BadRequestException(
        `Grading job ${gradingJobId} does not belong to the current user`,
      );
    }

    if (job.attemptId !== null && job.attemptId !== Number(attemptId)) {
      throw new BadRequestException(
        `Grading job ${gradingJobId} does not belong to attempt ${attemptId}`,
      );
    }

    request.on("close", () => {
      this.logger.info(
        `Client disconnected from grading job ${gradingJobId} stream`,
      );
      void this.attemptService.cleanupGradingJobStream(gradingJobId);
    });

    return this.attemptService.getGradingJobStatusStream(gradingJobId);
  }

  @Post(":attemptId/feedback")
  @Roles(UserRole.LEARNER)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "Submit feedback for an assignment attempt." })
  @ApiResponse({ status: 201, type: AssignmentFeedbackResponseDto })
  @ApiResponse({ status: 400, description: "Bad Request" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  submitFeedback(
    @Param("assignmentId") assignmentId: string,
    @Param("attemptId") attemptId: string,
    @Body() body: { feedback: AssignmentFeedbackDto },
    @Req() request: UserSessionRequest,
  ): Promise<AssignmentFeedbackResponseDto> {
    const feedbackDto = body.feedback;
    return this.attemptService.submitFeedback(
      Number(assignmentId),
      Number(attemptId),
      feedbackDto,
      request.userSession,
    );
  }

  @Get(":attemptId/feedback")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "Get feedback for an assignment attempt." })
  @ApiResponse({ status: 200, type: AssignmentFeedbackDto })
  @ApiResponse({ status: 403 })
  getFeedback(
    @Param("assignmentId") assignmentId: string,
    @Param("attemptId") attemptId: string,
    @Req() request: UserSessionRequest,
  ): Promise<AssignmentFeedbackDto> {
    return this.attemptService.getFeedback(
      Number(assignmentId),
      Number(attemptId),
      request.userSession,
    );
  }

  @Post(":attemptId/regrade")
  @Roles(UserRole.LEARNER)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "Request regrading for an assignment attempt." })
  @ApiResponse({ status: 201, type: RequestRegradingResponseDto })
  @ApiResponse({ status: 403 })
  processRegradingRequest(
    @Param("assignmentId") assignmentId: string,
    @Param("attemptId") attemptId: string,
    @Body() body: { regradingRequest: RegradingRequestDto },
    @Req() request: UserSessionRequest,
  ): Promise<AssignmentFeedbackResponseDto> {
    return this.attemptService.processRegradingRequest(
      Number(assignmentId),
      Number(attemptId),
      body.regradingRequest,
      request.userSession,
    );
  }

  @Get(":attemptId/regrade")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "Get regrading status for an assignment attempt." })
  @ApiResponse({ status: 200, type: RegradingStatusResponseDto })
  @ApiResponse({ status: 403 })
  getRegradingStatus(
    @Param("assignmentId") assignmentId: string,
    @Param("attemptId") attemptId: string,
    @Req() request: UserSessionRequest,
  ): Promise<RegradingStatusResponseDto> {
    return this.attemptService.getRegradingStatus(
      Number(assignmentId),
      Number(attemptId),
      request.userSession,
    );
  }

  @Post(":attemptId/report")
  @Roles(UserRole.AUTHOR, UserRole.LEARNER)
  @ApiOperation({ summary: "Submit a report for an assignment" })
  @ApiParam({
    name: "assignmentId",
    required: true,
    description: "ID of the assignment",
  })
  @ApiBody({
    description: "Report details",
    type: ReportRequestDTO,
  })
  @ApiResponse({ status: 201, description: "Report submitted successfully" })
  @ApiResponse({ status: 400, description: "Invalid input or missing fields" })
  @ApiResponse({ status: 403 })
  async submitReport(
    @Param("attemptId") attemptId: number,
    @Param("assignmentId") assignmentId: number,
    @Body() body: ReportRequestDTO,
    @Req() request: UserSessionRequest,
  ): Promise<{ message: string }> {
    const { issueType, description } = body;

    if (!issueType || !description) {
      throw new BadRequestException("Issue type and description are required");
    }

    const validIssueTypes = Object.values(ReportType);
    if (!validIssueTypes.includes(issueType)) {
      throw new BadRequestException("Invalid issue type");
    }

    const userId = request.userSession.userId;
    if (!userId || userId.trim() === "") {
      throw new BadRequestException("Invalid user ID");
    }

    await this.attemptService.createReport(
      Number(assignmentId),
      Number(attemptId),
      issueType,
      description,
      userId,
    );

    return { message: "Report submitted successfully" };
  }

  @Get("grading/monitoring")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({
    summary: "Get grading architecture monitoring data for debugging",
    description:
      "Returns statistics about grading audit records and logs usage summary",
  })
  @ApiResponse({
    status: 200,
    description: "Grading monitoring data",
    schema: {
      type: "object",
      properties: {
        message: { type: "string" },
        statistics: {
          type: "object",
          properties: {
            totalGradings: { type: "number" },
            strategiesByCount: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  strategy: { type: "string" },
                  count: { type: "number" },
                },
              },
            },
            mostActiveQuestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  questionId: { type: "number" },
                  count: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: "Forbidden - Author role required" })
  async getGradingMonitoring(): Promise<{
    message: string;
    statistics: any;
  }> {
    await this.gradingAuditService.logArchitectureUsageSummary();

    const statistics =
      await this.gradingAuditService.getGradingUsageStatistics();

    return {
      message:
        "Grading architecture usage summary logged. Check application logs for detailed output.",
      statistics,
    };
  }

  /**
   * Get LTI grade sync status for an assignment attempt
   */
  @Get(":attemptId/grade-sync-status")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({
    summary: "Get LTI grade sync status for an assignment attempt",
  })
  @ApiParam({
    name: "attemptId",
    description: "The ID of the assignment attempt",
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: "Grade sync status retrieved successfully",
  })
  @ApiResponse({
    status: 404,
    description: "Sync status not found",
  })
  async getGradeSyncStatus(@Param("attemptId") attemptId: number) {
    const syncStatus = await this.ltiGradeSyncService.getSyncStatus(
      Number(attemptId),
    );

    if (!syncStatus) {
      return null;
    }

    return syncStatus;
  }

  /**
   * Subscribe to email notification when grading is complete
   */
  @Post(":attemptId/notify")
  @Roles(UserRole.LEARNER)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({
    summary: "Subscribe to email notification when grading completes",
  })
  @ApiParam({
    name: "attemptId",
    description: "The ID of the assignment attempt",
    type: Number,
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        email: {
          type: "string",
          format: "email",
          description:
            "Email address to notify (optional, defaults to user email)",
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "Email notification subscription successful",
  })
  async subscribeToNotification(
    @Param("attemptId") attemptId: number,
    @Req() request: UserSessionRequest,
  ) {
    const email = request.userSession.userId;

    await this.gradingProgressService.enableEmailNotification(
      Number(attemptId),
      email,
    );

    return {
      success: true,
      message: `You will receive an email at ${email} when grading is complete`,
    };
  }
}
