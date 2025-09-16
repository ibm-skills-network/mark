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
  MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
  SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
  IN_COOLDOWN_PERIOD,
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
import { ReportRequestDTO } from "../assignment/attempt/dto/assignment-attempt/post.assignment.report.dto";
import { AssignmentAttemptAccessControlGuard } from "../assignment/attempt/guards/assignment.attempt.access.control.guard";
import { GRADING_AUDIT_SERVICE } from "./attempt.constants";
import { AttemptServiceV2 } from "./services/attempt.service";
import { GradingAuditService } from "./services/question-response/grading-audit.service";

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
    @Query("lang") lang?: string,
  ): Promise<GetAssignmentAttemptResponseDto> {
    return this.attemptService.getAssignmentAttempt(
      Number(assignmentAttemptId),
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
  ): Promise<GetAssignmentAttemptResponseDto> {
    return this.attemptService.getLearnerAssignmentAttempt(
      Number(assignmentAttemptId),
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
          type: "number",
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
  ): Promise<any> {
    // Parse IDs to ensure they're numbers
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

    // Always use SSE for submitted assignments
    const needsLongRunningGrading = true;
    // Check if this is author mode (might have fake attempt ID)
    const isAuthorMode = request.userSession.role === UserRole.AUTHOR;

    if (needsLongRunningGrading && !isAuthorMode) {
      // Only create grading jobs for real learner attempts
      const { gradingJobId, message } =
        await this.attemptService.createGradingJob(
          parsedAttemptId,
          parsedAssignmentId,
          learnerUpdateAssignmentAttemptDto,
          authCookie,
          request,
        );

      // Start the grading process asynchronously (don't await)
      this.attemptService
        .processGradingJob(
          gradingJobId,
          parsedAttemptId,
          parsedAssignmentId,
          learnerUpdateAssignmentAttemptDto,
          authCookie,
          request,
        )
        .catch((error) => {
          this.logger.error(`Grading job ${gradingJobId} failed:`, error);
        });

      // Return immediately with job ID
      return { gradingJobId, message };
    } else if (needsLongRunningGrading && isAuthorMode) {
      // For author mode, create a job without attemptId
      const { gradingJobId, message } =
        await this.attemptService.createAuthorGradingJob(
          parsedAssignmentId,
          learnerUpdateAssignmentAttemptDto,
          authCookie,
          request,
        );

      // Process author preview asynchronously
      this.attemptService
        .processAuthorPreviewJob(
          gradingJobId,
          parsedAssignmentId,
          learnerUpdateAssignmentAttemptDto,
          authCookie,
          request,
        )
        .catch((error) => {
          this.logger.error(
            `Author preview job ${gradingJobId} failed:`,
            error,
          );
        });

      return { gradingJobId, message };
    } else {
      // Regular synchronous update
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
    @Param("gradingJobId") gradingJobId: number,
    @Req() request: UserSessionRequest,
  ): Promise<Observable<MessageEvent>> {
    const job = await this.attemptService.getGradingJob(Number(gradingJobId));

    if (!job) {
      throw new NotFoundException(
        `Grading job with ID ${gradingJobId} not found`,
      );
    }

    // For author mode, attemptId might be null or not match
    // Only validate attemptId for learner jobs
    if (job.attemptId !== null && job.attemptId !== Number(attemptId)) {
      throw new BadRequestException(
        `Grading job ${gradingJobId} does not belong to attempt ${attemptId}`,
      );
    }

    request.on("close", () => {
      this.logger.info(
        `Client disconnected from grading job ${gradingJobId} stream`,
      );
      void this.attemptService.cleanupGradingJobStream(Number(gradingJobId));
    });

    return this.attemptService.getGradingJobStatusStream(Number(gradingJobId));
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
    // Log the usage summary to Winston logs
    await this.gradingAuditService.logArchitectureUsageSummary();

    // Also return statistics for API response
    const statistics =
      await this.gradingAuditService.getGradingUsageStatistics();

    return {
      message:
        "Grading architecture usage summary logged. Check application logs for detailed output.",
      statistics,
    };
  }
}
