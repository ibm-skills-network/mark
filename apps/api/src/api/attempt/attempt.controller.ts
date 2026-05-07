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
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { ReportType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Observable } from "rxjs";
import {
  UserRole,
  UserSessionRequest,
} from "src/auth/interfaces/user.session.interface";
import { Roles } from "src/auth/role/roles.global.guard";
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
import {
  AssignmentAttemptResponseDto,
  GetAssignmentAttemptResponseDto,
} from "../assignment/attempt/dto/assignment-attempt/get.assignment.attempt.response.dto";
import { UpdateAssignmentAttemptResponseDto } from "../assignment/attempt/dto/assignment-attempt/update.assignment.attempt.response.dto";
import { ReportRequestDTO } from "../assignment/attempt/dto/assignment-attempt/post.assignment.report.dto";
import { AssignmentAttemptAccessControlGuard } from "../assignment/attempt/guards/assignment.attempt.access.control.guard";
import { CreateQuestionResponseAttemptRequestDto } from "../assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "../assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { GRADING_AUDIT_SERVICE } from "./attempt.constants";
import { AttemptServiceV2 } from "./services/attempt.service";
import { GradingProgressService } from "./services/grading-progress.service";
import { GradingAuditService } from "./services/question-response/grading-audit.service";
import { LtiGradeSyncService } from "./services/lti-grade-sync.service";

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
  ) {
    this.logger = parentLogger.child({ context: AttemptControllerV2.name });
  }

  @Post()
  @Roles(UserRole.LEARNER)
  @UseGuards(AssignmentAttemptAccessControlGuard)
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

  @Get()
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "List assignment attempts for an assignment." })
  @ApiResponse({ status: 200, type: [AssignmentAttemptResponseDto] })
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
  ): Promise<AssignmentAttemptResponseDto[]> {
    return this.attemptService.listAssignmentAttempts(
      Number(assignmentId),
      request.userSession,
    );
  }

  @Get(":attemptId")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "Get an assignment attempt for an assignment." })
  @ApiResponse({ status: 200, type: GetAssignmentAttemptResponseDto })
  @ApiResponse({ status: 403 })
  getAssignmentAttempt(
    @Param("attemptId") assignmentAttemptId: number,
    @Req() request: UserSessionRequest,
    @Query("lang") lang?: string,
  ): Promise<GetAssignmentAttemptResponseDto> {
    return this.attemptService.getAssignmentAttempt(
      Number(assignmentAttemptId),
      request.userSession,
      lang,
    );
  }

  @Get(":attemptId/completed")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "Get an assignment attempt for an assignment." })
  @ApiResponse({ status: 200, type: GetAssignmentAttemptResponseDto })
  @ApiResponse({ status: 403 })
  getLearnerAssignmentAttempt(
    @Param("attemptId") assignmentAttemptId: number,
    @Req() request: UserSessionRequest,
  ): Promise<GetAssignmentAttemptResponseDto> {
    return this.attemptService.getLearnerAssignmentAttempt(
      Number(assignmentAttemptId),
      request.userSession,
    );
  }

  @Patch(":attemptId")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({
    summary: "Update an assignment attempt for an assignment.",
  })
  @ApiBody({
    type: LearnerUpdateAssignmentAttemptRequestDto,
    required: true,
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: "object",
      properties: {
        gradingJobId: {
          type: "string",
          description: "Job ID for tracking grading progress",
        },
        message: { type: "string", description: "Status message" },
      },
    },
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
  @ApiResponse({ status: 403 })
  async updateAssignmentAttempt(
    @Param("attemptId") attemptId: number,
    @Param("assignmentId") assignmentId: number,
    @Body()
    learnerUpdateAssignmentAttemptDto: LearnerUpdateAssignmentAttemptRequestDto,
    @Req() request: UserSessionRequest,
  ): Promise<
    | { gradingJobId: string; message: string }
    | UpdateAssignmentAttemptResponseDto
  > {
    const parsedAttemptId = Number(attemptId);
    const parsedAssignmentId = Number(assignmentId);

    this.logger.info(
      `Updating attempt: attemptId=${parsedAttemptId}, assignmentId=${parsedAssignmentId}`,
    );

    const authCookie: string =
      typeof request?.cookies?.authentication === "string"
        ? request.cookies.authentication
        : "";
    const gradingCallbackRequired =
      request?.userSession.gradingCallbackRequired ?? false;

    const needsLongRunningGrading = true;
    const isAuthorMode = request.userSession.role === UserRole.AUTHOR;

    if (needsLongRunningGrading && !isAuthorMode) {
      const { gradingJobId, message } =
        await this.attemptService.createGradingJob(
          parsedAttemptId,
          parsedAssignmentId,
          learnerUpdateAssignmentAttemptDto,
          authCookie,
          request,
        );

      await this.attemptService.enqueueGradingJob(
        gradingJobId,
        parsedAttemptId,
        parsedAssignmentId,
        learnerUpdateAssignmentAttemptDto,
        authCookie,
        request,
      );

      return { gradingJobId, message };
    } else if (needsLongRunningGrading && isAuthorMode) {
      const { gradingJobId, message } =
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
      );
      return result;
    }
  }

  @Post(":attemptId/questions/:questionId/responses")
  @Roles(UserRole.LEARNER)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "Auto-save a question response for an attempt." })
  @ApiResponse({ status: 201, type: CreateQuestionResponseAttemptResponseDto })
  async submitQuestionResponse(
    @Param("assignmentId") assignmentId: number,
    @Param("attemptId") attemptId: number,
    @Param("questionId") questionId: number,
    @Body() body: CreateQuestionResponseAttemptRequestDto,
    @Req() request: UserSessionRequest,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    const language =
      body.selectedLanguage ||
      body.language ||
      request.userSession.launch_presentation_locale ||
      "en";

    return this.attemptService.autoSaveQuestionResponse(
      Number(attemptId),
      Number(assignmentId),
      Number(questionId),
      body,
      request.userSession,
      language,
    );
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
   * Get grading progress for an attempt
   */
  @Get(":attemptId/progress")
  @Roles(UserRole.LEARNER)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({
    summary: "Get real-time grading progress for an assignment attempt",
  })
  @ApiParam({
    name: "attemptId",
    description: "The ID of the assignment attempt",
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: "Grading progress retrieved successfully",
  })
  @ApiResponse({
    status: 404,
    description: "Progress not found",
  })
  async getGradingProgress(@Param("attemptId") attemptId: number) {
    const progress = await this.gradingProgressService.getProgress(
      Number(attemptId),
    );

    if (!progress) {
      throw new NotFoundException(
        `Grading progress not found for attempt ${attemptId}`,
      );
    }

    return progress;
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
