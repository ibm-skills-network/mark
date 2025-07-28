import {
  Body,
  Controller,
  Get,
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
import {
  UserRole,
  UserSessionRequest,
} from "src/auth/interfaces/user.session.interface";
import { Roles } from "src/auth/role/roles.global.guard";
import { PrismaService } from "src/prisma.service";
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
import { AssignmentServiceV2 } from "../services/assignment.service";
import { JobStatusServiceV2 } from "../services/job-status.service";
import { QuestionService } from "../services/question.service";
import { ReportService } from "../services/report.repository";

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
    private readonly questionService: QuestionService,
    private readonly reportService: ReportService,
    private readonly jobStatusService: JobStatusServiceV2,
    private readonly prisma: PrismaService,
  ) {
    this.logger = parentLogger.child({ context: AssignmentControllerV2.name });
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
  @ApiOperation({ summary: "Stream publish job status" })
  @ApiParam({ name: "jobId", required: true, description: "Job ID" })
  @Sse()
  async sendPublishJobStatus(
    @Param("jobId", ParseIntPipe) jobId: number,
    @Req() request: Request,
  ): Promise<Observable<MessageEvent>> {
    const job = await this.prisma.publishJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
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
        jobId: { type: "number", description: "Job ID for tracking progress" },
        message: { type: "string", description: "Status message" },
      },
    },
  })
  async publishAssignment(
    @Param("id", ParseIntPipe) id: number,
    @Body(new ValidationPipe({ transform: true }))
    updatedAssignment: UpdateAssignmentQuestionsDto,
    @Req() request: UserSessionRequest,
  ): Promise<{ jobId: number; message: string }> {
    return this.assignmentService.publishAssignment(
      id,
      updatedAssignment,
      request.userSession.userId,
    );
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
  async getJobStatus(@Param("jobId", ParseIntPipe) jobId: number): Promise<{
    status: string;
    progress: string;
    questions?: QuestionDto[];
  }> {
    const job = await this.jobStatusService.getJobStatus(jobId);
    if (!job) {
      throw new NotFoundException("Job not found");
    }

    return job.status === "Completed"
      ? {
          status: job.status,
          progress: job.progress,
          questions: job.result
            ? (JSON.parse(job.result as string) as QuestionDto[])
            : undefined,
        }
      : { status: job.status, progress: job.progress };
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
        jobId: { type: "number", description: "Job ID for tracking progress" },
      },
    },
  })
  async generateQuestions(
    @Param("assignmentId", ParseIntPipe) assignmentId: number,
    @Body(new ValidationPipe({ transform: true }))
    payload: QuestionGenerationPayload,
    @Req() request: UserSessionRequest,
  ): Promise<{ message: string; jobId: number }> {
    return this.questionService.generateQuestions(
      assignmentId,
      payload,
      request.userSession.userId,
    );
  }
}
