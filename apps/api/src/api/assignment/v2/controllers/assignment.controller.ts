import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Sse,
  UseGuards,
  ValidationPipe,
} from "@nestjs/common";
import {
  ApiBody,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  refs,
} from "@nestjs/swagger";
import { Request } from "express";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Observable } from "rxjs";
import { AdminService } from "src/api/admin/admin.service";
import { AdminGuard } from "src/auth/guards/admin.guard";
import {
  UserRole,
  UserSession,
  UserSessionRequest,
} from "src/auth/interfaces/user.session.interface";
import { Roles } from "src/auth/role/roles.global.guard";
import { PrismaService } from "src/database/prisma.service";
import { JobStateRecord } from "src/job-queue/job-state.types";
import { Logger } from "winston";
import { ReportRequestDTO } from "../../attempt/dto/assignment-attempt/post.assignment.report.dto";
import { ASSIGNMENT_SCHEMA_URL } from "../../constants";
import { BaseAssignmentResponseDto } from "../../dto/base.assignment.response.dto";
import {
  AssignmentResponseDto,
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "../../dto/get.assignment.response.dto";
import { QuestionGenerationPayload } from "../../dto/post.assignment.request.dto";
import { ReplaceAssignmentRequestDto } from "../../dto/replace.assignment.request.dto";
import { UpdateAssignmentRequestDto } from "../../dto/update.assignment.request.dto";
import {
  GenerateQuestionVariantDto,
  QuestionDto,
  UpdateAssignmentQuestionsDto,
} from "../../dto/update.questions.request.dto";
import { AssignmentAccessControlGuard } from "../../guards/assignment.access.control.guard";
import {
  CompleteAssignmentFileDto,
  InitiateAssignmentFilesDto,
  InitiateAssignmentFilesResponseDto,
} from "../dtos/assignment-file-upload.dto";
import { AssignmentFileService } from "../services/assignment-file.service";
import { AssignmentServiceV2 } from "../services/assignment.service";
import { JobStatusServiceV2 } from "../services/job-status.service";
import { QuestionService } from "../services/question.service";
import { ReportService } from "../services/report.repository";

interface AssignmentAnalyticsResponse {
  data: Array<{
    id: number;
    name: string;
    totalCost: number;
    uniqueLearners: number;
    totalAttempts: number;
    completedAttempts: number;
    averageGrade: number;
    averageRating: number;
    published: boolean;
    insights: {
      questionInsights: Array<{
        questionId: number;
        questionText: string;
        correctPercentage: number;
        firstAttemptSuccessRate: number;
        avgPointsEarned: number;
        maxPoints: number;
        insight: string;
      }>;
      performanceInsights: string[];
      costBreakdown: {
        grading: number;
        questionGeneration: number;
        translation: number;
        other: number;
      };
    };
  }>;
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Controller that handles assignment-related API endpoints
 */
@ApiTags("Assignments")
@Injectable()
@Controller({
  path: "assignments",
  version: "2",
})
export class AssignmentControllerV2 {
  private readonly logger: Logger;

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly parentLogger: Logger,
    private readonly assignmentService: AssignmentServiceV2,
    private readonly assignmentFileService: AssignmentFileService,
    private readonly questionService: QuestionService,
    private readonly reportService: ReportService,
    private readonly jobStatusService: JobStatusServiceV2,
    private readonly adminService: AdminService,
    private readonly prisma: PrismaService,
  ) {
    this.logger = parentLogger.child({ context: AssignmentControllerV2.name });
  }

  // Returns true when the caller may read this publish job's status. Allows the
  // job's creator OR any author whose group is linked to the job's assignment.
  // Co-author access is required because publishAssignment dedups by
  // assignmentId and returns an in-flight job's id to a second author who hits
  // publish on the same assignment — they need to watch it complete.
  private async canReadPublishJob(
    job: JobStateRecord,
    userSession: UserSession,
  ): Promise<boolean> {
    if (job.userId === userSession.userId) {
      return true;
    }

    if (typeof job.assignmentId !== "number") {
      return false;
    }

    // Refuse when the session has no groupId — Prisma silently drops undefined
    // keys from `where`, and without this guard the query collapses to
    // `{ assignmentId }` and returns the first AssignmentGroup row for the
    // assignment, granting cross-tenant read of any deterministic publish job.
    if (
      typeof userSession.groupId !== "string" ||
      userSession.groupId.length === 0
    ) {
      return false;
    }

    const link = await this.prisma.assignmentGroup.findFirst({
      where: {
        assignmentId: job.assignmentId,
        groupId: userSession.groupId,
      },
      select: { assignmentId: true },
    });

    return link !== null;
  }

  /**
   * Get assignment by ID - different response format based on user role
   */
  @Get(":id")
  @Roles(UserRole.AUTHOR, UserRole.LEARNER)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "Get assignment" })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiExtraModels(GetAssignmentResponseDto, LearnerGetAssignmentResponseDto)
  @ApiResponse({
    status: 200,
    schema: {
      anyOf: refs(GetAssignmentResponseDto, LearnerGetAssignmentResponseDto),
    },
    description: "Response structure varies based on user role",
  })
  @ApiQuery({
    name: "lang",
    required: false,
    type: "string",
    description: "Language code to translate questions by",
  })
  async getAssignment(
    @Param("id", ParseIntPipe) id: number,
    @Req() request: UserSessionRequest,
    @Query("lang") lang?: string,
  ): Promise<GetAssignmentResponseDto | LearnerGetAssignmentResponseDto> {
    return this.assignmentService.getAssignment(id, request.userSession, lang);
  }

  /**
   * Insights for one of the author's own assignments (ownership-scoped). The
   * author-facing counterpart to the admin insights endpoint — same data, minus
   * admin-only issue reports, over the normal app session.
   */
  @Get(":id/insights")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Author insights for one of their own assignments" })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiResponse({ status: 200 })
  async getAuthorAssignmentInsights(
    @Param("id", ParseIntPipe) id: number,
    @Req() request: UserSessionRequest,
  ): Promise<Record<string, unknown>> {
    // Enforce ownership here, not only in the service: the insights cache can
    // short-circuit the service's authorship filter, so a fresh check stops an
    // author reading another author's assignment via a warm cache.
    const owns = await this.prisma.assignmentAuthor.findFirst({
      where: { assignmentId: id, userId: request.userSession.userId },
    });
    if (!owns) {
      throw new NotFoundException("Assignment not found");
    }

    const insights = (await this.adminService.getDetailedAssignmentInsights(
      request.userSession,
      id,
    )) as Record<string, unknown>;

    // Whitelist projection: the admin payload also carries platform-wide and
    // internal-only data (other authors' cross-assignment activity and emails,
    // raw model keys / per-token prices, and AI spend). Authors only get their
    // own assignment's learner-scoped data, so build the response by copying the
    // allowed keys rather than spreading-then-deleting — a new admin-only field
    // added upstream then can't leak through by default.
    const analytics = (insights.analytics ?? {}) as Record<string, unknown>;
    return {
      assignment: insights.assignment,
      questions: insights.questions,
      attempts: insights.attempts,
      feedback: insights.feedback,
      analytics: {
        uniqueLearners: analytics.uniqueLearners,
        totalAttempts: analytics.totalAttempts,
        completedAttempts: analytics.completedAttempts,
        averageGrade: analytics.averageGrade,
        averageRating: analytics.averageRating,
        performanceInsights: analytics.performanceInsights,
      },
      // Issue reports are admin-only; never expose them on the author surface.
      reports: [],
    };
  }

  /**
   * List assignments for the current user
   */
  @Get()
  @Roles(UserRole.AUTHOR, UserRole.LEARNER)
  @ApiOperation({ summary: "List Assignments" })
  @ApiResponse({
    status: 200,
    type: [AssignmentResponseDto],
    description: "List assignments scoped to the user's role",
  })
  async listAssignments(
    @Req() request: UserSessionRequest,
  ): Promise<AssignmentResponseDto[]> {
    return this.assignmentService.listAssignments(request.userSession);
  }

  /**
   * Update an assignment's properties
   */
  @Patch(":id")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "Update assignment" })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiBody({
    type: UpdateAssignmentRequestDto,
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  updateAssignment(
    @Param("id", ParseIntPipe) id: number,
    @Body(new ValidationPipe({ transform: true }))
    updateAssignmentRequestDto: UpdateAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    return this.assignmentService.updateAssignment(
      id,
      updateAssignmentRequestDto,
    );
  }

  /**
   * Stream job status updates for publishing an assignment
   */
  @Get("jobs/:jobId/status-stream")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Stream publish job status" })
  @ApiParam({ name: "jobId", required: true, description: "Job ID" })
  @Sse()
  async sendPublishJobStatus(
    @Param("jobId") jobId: string,
    @Req() request: UserSessionRequest & Request,
  ): Promise<Observable<MessageEvent>> {
    const job = await this.jobStatusService.getJobStatus(jobId);
    if (!job) {
      throw new NotFoundException(`Publish job with ID ${jobId} not found`);
    }

    const allowed = await this.canReadPublishJob(job, request.userSession);
    if (!allowed) {
      throw new NotFoundException(`Publish job with ID ${jobId} not found`);
    }

    request.on("close", () => {
      this.logger.info(`Client disconnected from job ${jobId} stream`);
      void this.jobStatusService.cleanupJobStream(jobId);
    });

    return this.jobStatusService.getPublishJobStatusStream(jobId);
  }
  /**
   * Publish an assignment with updated questions
   */
  @Put(":id/publish")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "Publish assignment with updated questions" })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiBody({
    type: UpdateAssignmentQuestionsDto,
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Job ID for tracking progress" },
        message: { type: "string", description: "Status message" },
      },
    },
  })
  async publishAssignment(
    @Param("id", ParseIntPipe) id: number,
    @Body(new ValidationPipe({ transform: true }))
    updatedAssignment: UpdateAssignmentQuestionsDto,
    @Req() request: UserSessionRequest,
  ): Promise<{ jobId: string; message: string }> {
    return this.assignmentService.publishAssignment(
      id,
      updatedAssignment,
      request.userSession.userId,
    );
  }

  /**
   * Look up the in-flight publish job for an assignment, if any.
   * Returns null when no publish is active so the client can reattach
   * to the SSE stream after a page refresh without having to start a
   * new publish.
   */
  @Get(":id/active-publish-job")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "Find the in-flight publish job for an assignment" })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiResponse({
    status: 200,
    schema: {
      type: "object",
      nullable: true,
      properties: {
        jobId: { type: "string" },
      },
    },
  })
  async getActivePublishJob(
    @Param("id", ParseIntPipe) id: number,
  ): Promise<{ jobId: string } | null> {
    const job = await this.assignmentService.findActivePublishJob(id);
    return job ? { jobId: job.id } : null;
  }

  /**
   * Retry the failed translations from the most recent publish for this
   * assignment. Reads the publish's per-job status hash, re-enqueues a
   * translation job per failed entry, and returns a new jobId the client
   * can subscribe to via SSE to track retry progress.
   *
   * Returns 409 if a publish is currently active — wait for it to finish,
   * then click retry.
   */
  @Post(":id/translations/retry-failed")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({
    summary: "Retry failed translations from the most recent publish",
  })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiResponse({
    status: 200,
    schema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "Retry job ID for SSE" },
        message: { type: "string" },
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: "A publish is currently in progress for this assignment",
  })
  async retryFailedTranslations(
    @Param("id", ParseIntPipe) id: number,
    @Req() request: UserSessionRequest,
  ): Promise<{ jobId: string; message: string }> {
    return this.assignmentService.enqueueRetryFailedTranslations(
      id,
      request.userSession.userId,
    );
  }

  @Get(":id/files")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "List files for an assignment" })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiResponse({
    status: 200,
    description: "List of files associated with the assignment",
  })
  async getAssignmentFiles(@Param("id", ParseIntPipe) id: number) {
    return this.assignmentFileService.getAssignmentFiles(id);
  }

  @Post(":id/files/initiate")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({
    summary:
      "Initiate multipart uploads for assignment files (returns presigned part URLs)",
  })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiBody({ type: InitiateAssignmentFilesDto })
  @ApiResponse({
    status: 201,
    type: InitiateAssignmentFilesResponseDto,
    description:
      "Per-file uploadId, key, bucket, part size and presigned part URLs",
  })
  async initiateAssignmentFileUploads(
    @Param("id", ParseIntPipe) id: number,
    @Body(new ValidationPipe({ transform: true }))
    dto: InitiateAssignmentFilesDto,
    @Req() request: UserSessionRequest,
  ): Promise<InitiateAssignmentFilesResponseDto> {
    return this.assignmentFileService.initiateAssignmentFileUploads(
      id,
      dto,
      request.userSession.userId,
    );
  }

  @Post(":id/files/:fileId/complete")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({
    summary:
      "Complete a multipart upload for an assignment file and extract content",
  })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiParam({ name: "fileId", required: true, description: "File ID" })
  @ApiBody({ type: CompleteAssignmentFileDto })
  @ApiResponse({
    status: 201,
    description:
      "File record updated to READY (or FAILED extraction) and extracted content persisted",
  })
  async completeAssignmentFileUpload(
    @Param("id", ParseIntPipe) id: number,
    @Param("fileId", ParseIntPipe) fileId: number,
    @Body(new ValidationPipe({ transform: true }))
    dto: CompleteAssignmentFileDto,
  ) {
    return this.assignmentFileService.completeAssignmentFileUpload(
      id,
      fileId,
      dto,
    );
  }

  @Post(":id/files/:fileId/abort")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @HttpCode(204)
  @ApiOperation({
    summary:
      "Abort an in-progress multipart upload and remove the placeholder row",
  })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiParam({ name: "fileId", required: true, description: "File ID" })
  @ApiResponse({ status: 204, description: "Upload aborted" })
  async abortAssignmentFileUpload(
    @Param("id", ParseIntPipe) id: number,
    @Param("fileId", ParseIntPipe) fileId: number,
  ): Promise<void> {
    return this.assignmentFileService.abortAssignmentFileUpload(id, fileId);
  }

  @Delete(":id/files/:fileId")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "Delete a file from an assignment" })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiParam({ name: "fileId", required: true, description: "File ID" })
  @ApiResponse({ status: 204, description: "File deleted successfully" })
  @HttpCode(204)
  async deleteAssignmentFile(
    @Param("id", ParseIntPipe) id: number,
    @Param("fileId", ParseIntPipe) fileId: number,
  ): Promise<void> {
    return this.assignmentFileService.deleteAssignmentFile(id, fileId);
  }

  /**
   * Generate variants for questions
   */
  @Post(":id/question/generate-variant")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "Generate a new variant for a question" })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiBody({
    type: GenerateQuestionVariantDto,
    description: "Question variant generation configuration",
  })
  @ApiResponse({
    status: 200,
    type: BaseAssignmentResponseDto,
    description: "Generated variants for questions",
  })
  async generateQuestionVariant(
    @Param("id", ParseIntPipe) id: number,
    @Body(new ValidationPipe({ transform: true }))
    generateQuestionVariantDto: GenerateQuestionVariantDto,
  ): Promise<BaseAssignmentResponseDto & { questions?: QuestionDto[] }> {
    return this.questionService.generateQuestionVariants(
      id,
      generateQuestionVariantDto,
    );
  }

  /**
   * Get available languages for an assignment
   */
  @Get(":id/languages")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @ApiOperation({ summary: "Get available languages" })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiResponse({
    status: 200,
    schema: {
      type: "object",
      properties: {
        languages: {
          type: "array",
          items: { type: "string" },
          description: "Available language codes",
        },
      },
    },
  })
  async getAvailableLanguages(
    @Param("id", ParseIntPipe) id: number,
  ): Promise<{ languages: string[] }> {
    const languages = await this.assignmentService.getAvailableLanguages(id);
    return { languages };
  }

  /**
   * Replace an entire assignment
   */
  @Put(":id")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "Replace assignment" })
  @ApiParam({ name: "id", required: true, description: "Assignment ID" })
  @ApiBody({
    type: ReplaceAssignmentRequestDto,
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  replaceAssignment(
    @Param("id", ParseIntPipe) id: number,
    @Body(new ValidationPipe({ transform: true }))
    replaceAssignmentRequestDto: ReplaceAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    return this.assignmentService.replaceAssignment(
      id,
      replaceAssignmentRequestDto,
    );
  }

  /**
   * Get the status of a job
   */
  @Get("jobs/:jobId/status")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Get job status" })
  @ApiParam({ name: "jobId", required: true, description: "Job ID" })
  @ApiResponse({
    status: 200,
    schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Current job status" },
        progress: { type: "string", description: "Progress description" },
        questions: {
          type: "array",
          items: { type: "object" },
          description: "Generated questions (only when status is Completed)",
        },
      },
    },
  })
  async getJobStatus(
    @Param("jobId") jobId: string,
    @Req() request: UserSessionRequest,
  ): Promise<{
    status: string;
    progress: string;
    questions?: QuestionDto[];
    // Raw job.result is returned alongside questions so the SSE-fallback
    // poller can render publish/retry progress (PublishJobResult shape)
    // when the EventSource drops mid-publish — without this the UI never
    // sees failed translations or the retry-button trigger.
    result?: unknown;
  }> {
    const job = await this.jobStatusService.getJobStatus(jobId);
    if (!job) {
      throw new NotFoundException("Job not found");
    }

    const allowed = await this.canReadPublishJob(job, request.userSession);
    if (!allowed) {
      throw new NotFoundException("Job not found");
    }

    // Question-generation jobs store QuestionDto[] on result; publish /
    // retry jobs store a PublishJobResult object. Surface both shapes:
    // questions[] for the existing question-gen path, result for everything
    // else. Client type-guards the result field.
    const isQuestionsArray = Array.isArray(job.result);
    return {
      status: job.status,
      progress: job.progress,
      questions:
        job.status === "Completed" && isQuestionsArray
          ? (job.result as QuestionDto[])
          : undefined,
      result: job.result,
    };
  }

  /**
   * Submit a report for an assignment
   */
  @Post(":assignmentId/report")
  @Roles(UserRole.AUTHOR)
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
  async submitReport(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Body(new ValidationPipe({ transform: true })) body: ReportRequestDTO,
    @Req() request: UserSessionRequest,
  ): Promise<{ message: string }> {
    await this.reportService.createReport(
      assignmentId,
      body.issueType,
      body.description,
      request.userSession.userId,
    );

    return { message: "Report submitted successfully" };
  }

  /**
   * Generate questions for an assignment
   */
  @Post(":assignmentId/generate-questions")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "Generate questions for the assignment" })
  @ApiParam({
    name: "assignmentId",
    required: true,
    description: "ID of the assignment",
  })
  @ApiBody({
    description: "Question generation configuration",
    type: Object,
  })
  @ApiResponse({
    status: 201,
    description: "Question generation started",
    schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Status message" },
        jobId: { type: "string", description: "Job ID for tracking progress" },
      },
    },
  })
  async generateQuestions(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Body(new ValidationPipe({ transform: true }))
    payload: QuestionGenerationPayload,
    @Req() request: UserSessionRequest,
  ): Promise<{ message: string; jobId: string }> {
    return this.questionService.generateQuestions(
      assignmentId,
      payload,
      request.userSession.userId,
    );
  }

  /**
   * Get assignment analytics with detailed insights
   */
  @Get("analytics")
  // Admin-only is enforced by AdminGuard (it rejects any non-admin session). No
  // @Roles here: the global RolesGlobalGuard runs before AdminGuard and is a
  // no-op without @Roles metadata, so the request reaches AdminGuard, which is
  // the sole gate. Adding @Roles(AUTHOR, ...) here would be misleading — it
  // never widens access past AdminGuard, only obscures who can actually reach
  // this route.
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: "Get detailed assignment analytics with insights (admin only)",
  })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "search", required: false, type: String })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 403 })
  async getAssignmentAnalytics(
    @Req() request: UserSessionRequest,
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("limit", new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query("search") search?: string,
  ): Promise<AssignmentAnalyticsResponse> {
    return await this.adminService.getAssignmentAnalytics(
      request.userSession,
      page,
      limit,
      search,
    );
  }
}
