import {
  BadRequestException,
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
import { ReportType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import {
  concatWith,
  EMPTY,
  from,
  interval,
  Observable,
  of,
  Subject,
  timer,
} from "rxjs";
import {
  catchError,
  expand,
  finalize,
  map,
  mergeMap,
  switchMap,
  takeWhile,
  tap,
} from "rxjs/operators";
import { Logger } from "winston";
import {
  UserRole,
  UserSessionRequest,
} from "../../auth/interfaces/user.session.interface";
import { Roles } from "../../auth/role/roles.global.guard";
import { JobStatusService } from "../Job/job-status.service";
import { LlmService } from "../llm/llm.service";
import { AssignmentService } from "./assignment.service";
import { ReportRequestDTO } from "./attempt/dto/assignment-attempt/post.assignment.report.dto";
import { ASSIGNMENT_SCHEMA_URL } from "./constants";
import {
  BaseAssignmentResponseDto,
  UpdateAssignmentQuestionsResponseDto,
} from "./dto/base.assignment.response.dto";
import {
  AssignmentResponseDto,
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "./dto/get.assignment.response.dto";
import { QuestionGenerationPayload } from "./dto/post.assignment.request.dto";
import { ReplaceAssignmentRequestDto } from "./dto/replace.assignment.request.dto";
import { UpdateAssignmentRequestDto } from "./dto/update.assignment.request.dto";
import {
  GenerateQuestionVariantDto,
  QuestionDto,
  UpdateAssignmentQuestionsDto,
} from "./dto/update.questions.request.dto";
import { AssignmentAccessControlGuard } from "./guards/assignment.access.control.guard";
import { LLMResponseQuestion } from "./question/dto/create.update.question.request.dto";

@ApiTags(
  "Assignments (All endpoints need a user-session header (injected using the API Gateway)"
)
@Injectable()
@Controller({
  path: "assignments",
  version: "1",
})
export class AssignmentController {
  private logger;
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private parentLogger: Logger,
    private readonly assignmentService: AssignmentService,
    private readonly llmService: LlmService,
    private readonly jobStatusService: JobStatusService
  ) {
    this.logger = parentLogger.child({ context: AssignmentController.name });
  }

  @Get(":id")
  @Roles(UserRole.AUTHOR, UserRole.LEARNER)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "Get assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiExtraModels(GetAssignmentResponseDto, LearnerGetAssignmentResponseDto)
  @ApiResponse({
    status: 200,
    schema: {
      anyOf: refs(GetAssignmentResponseDto, LearnerGetAssignmentResponseDto),
    },
    description:
      "The response structure varies based on the role of the user requesting the assignment i.e. learner/author/admin (see schema).",
  })
  @ApiQuery({
    name: "lang",
    required: false,
    type: "string",
    description: "Language code to translate questions by",
  })
  @ApiResponse({ status: 403 })
  async getAssignment(
    @Param("id") id: number,
    @Req() request: UserSessionRequest,
    @Query("lang") lang?: string
  ): Promise<GetAssignmentResponseDto | LearnerGetAssignmentResponseDto> {
    return this.assignmentService.get(Number(id), request.userSession, lang);
  }

  @Get()
  @Roles(UserRole.AUTHOR, UserRole.LEARNER)
  @ApiOperation({ summary: "List Assignments" })
  @ApiResponse({
    status: 200,
    type: [AssignmentResponseDto],
    description:
      "List assignments scoped to the user's role (doest include questions to avoid potentially large queries).",
  })
  @ApiResponse({ status: 403 })
  async listAssignments(
    @Req() request: UserSessionRequest
  ): Promise<AssignmentResponseDto[]> {
    return this.assignmentService.list(request.userSession);
  }

  @Patch(":id")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "Update assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiBody({
    type: UpdateAssignmentRequestDto,
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  updateAssignment(
    @Param("id") id: number,
    @Body() updateAssignmentRequestDto: UpdateAssignmentRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    return this.assignmentService.update(
      Number(id),
      updateAssignmentRequestDto
    );
  }
  // Streaming real-time updates with proper completion handling
  @Get("jobs/:jobId/status-stream")
  @ApiOperation({ summary: "Stream publish job status" })
  @ApiParam({ name: "jobId", required: true, description: "Job ID" })
  @Sse("jobs/:jobId/status-stream")
  sendPublishJobStatus(
    @Param("jobId", ParseIntPipe) jobId: number
  ): Observable<MessageEvent> {
    return this.jobStatusService.getJobStatusStream(jobId).pipe(
      map((event) => ({
        ...event,
        type: (event.data as { done: boolean }).done ? "finalize" : "update",
      })),
      concatWith(
        of({
          type: "close",
          data: { message: "Stream completed" },
        } as MessageEvent)
      ),
      finalize(() => {
        console.log(`Stream closed for job ${jobId}`);
        this.jobStatusService.cleanupJobStream(jobId);
      }),
      // Error handling
      catchError((error: Error) => {
        console.error(`Stream error for job ${jobId}:`, error);
        return of({
          type: "error",
          data: {
            error: error.message,
            done: true,
          },
        } as MessageEvent);
      })
    );
  }
  @Put(":id/publish")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "Update all questions for an assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiBody({
    type: UpdateAssignmentRequestDto,
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  async updateAssignmentQuestions(
    @Param("id") id: number,
    @Body() updatedAssignment: UpdateAssignmentQuestionsDto,
    @Req() request: UserSessionRequest
  ): Promise<{ jobId: number; message: string }> {
    if (
      updatedAssignment === undefined ||
      updatedAssignment.questions === undefined ||
      updatedAssignment.questions?.length === 0
    ) {
      throw new BadRequestException("No data was provided");
    }
    return await this.assignmentService.publishAssignment(
      Number(id),
      updatedAssignment,
      request.userSession.userId
    );
  }

  @Post(":id/question/generate-variant")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "Generate a new variant for a question" })
  @ApiParam({ name: "id", required: true })
  @ApiBody({
    type: UpdateAssignmentRequestDto,
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  async generateQuestionVariant(
    @Param("id") id: number,
    @Body() generateQuestionVariantDto: GenerateQuestionVariantDto
  ): Promise<
    BaseAssignmentResponseDto & {
      questions?: QuestionDto[];
    }
  > {
    return this.assignmentService.generateVariantsFromQuestions(
      Number(id),
      generateQuestionVariantDto
    );
  }
  // controller to get available languages
  @Get(":id/languages")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @ApiOperation({ summary: "Get available languages" })
  @ApiParam({ name: "id", required: true })
  @ApiResponse({ status: 200, type: [String] })
  @ApiResponse({ status: 403 })
  async getAvailableLanguages(
    @Param("id") id: number
  ): Promise<{ languages: string[] }> {
    const languages = await this.assignmentService.getAvailableLanguages(
      Number(id)
    );
    return { languages };
  }

  // controller to test language detection
  @Post("test-language-detection")
  @ApiOperation({ summary: "Test language detection" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          example: "This is a test string",
          description: "The string to test language detection on",
        },
      },
    },
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  async testLanguageDetection(
    @Body() language: { text: string }
  ): Promise<{ languageCode: string }> {
    const languageCode: string = await this.llmService.getLanguageCode(
      language.text
    );
    return { languageCode };
  }

  @Put(":id")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentAccessControlGuard)
  @ApiOperation({ summary: "Replace assignment" })
  @ApiParam({ name: "id", required: true })
  @ApiBody({
    type: ReplaceAssignmentRequestDto,
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({ status: 200, type: BaseAssignmentResponseDto })
  @ApiResponse({ status: 403 })
  replaceAssignment(
    @Param("id") id: number,
    @Body() replaceAssignmentRequestDto: ReplaceAssignmentRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    return this.assignmentService.replace(
      Number(id),
      replaceAssignmentRequestDto
    );
  }

  @Get("jobs/:jobId/status")
  async getJobStatus(@Param("jobId", ParseIntPipe) jobId: number): Promise<{
    status: string;
    progress: string;
    questions?: LLMResponseQuestion[];
  }> {
    const job = await this.assignmentService.getJobStatus(jobId);
    if (!job) {
      throw new NotFoundException("Job not found");
    }
    return job.status === "Completed"
      ? {
          status: job.status,
          progress: job.progress,
          questions: job.result as unknown as LLMResponseQuestion[],
        }
      : { status: job.status, progress: job.progress };
  }

  @Sse("jobs/:jobId/status-stream")
  sendJobStatus(@Param("jobId") jobId: number): Observable<MessageEvent> {
    return interval(1000).pipe(
      mergeMap(async () => {
        const job = await this.assignmentService.getJobStatus(jobId);
        if (!job) {
          throw new NotFoundException("Job not found");
        }
        return { data: { status: job.status, progress: job.progress } };
      }),
      map((data) => ({ data } as MessageEvent))
    );
  }

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
  @ApiResponse({ status: 400, description: "Invalid input or missing fields" })
  @ApiResponse({ status: 403 })
  async submitReport(
    @Param("assignmentId") assignmentId: number,
    @Body() body: ReportRequestDTO,
    @Req() request: UserSessionRequest
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
    await this.assignmentService.createReport(
      Number(assignmentId),
      issueType,
      description,
      userId
    );

    return { message: "Report submitted successfully" };
  }
  @Post(":assignmentId/generate-questions")
  @ApiOperation({ summary: "Upload contents of files for the assignment" })
  @ApiBody({
    description: "Upload file contents for an assignment",
    schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              filename: { type: "string" },
              content: { type: "string" },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: "Files content uploaded successfully",
  })
  @ApiResponse({
    status: 400,
    description: "Invalid file contents or no contents",
  })
  async uploadFileContents(
    @Param("assignmentId") assignmentId: number,
    @Body() body: QuestionGenerationPayload,
    @Req() request: UserSessionRequest
  ): Promise<{ message: string; jobId: number }> {
    const {
      fileContents,
      learningObjectives,
      assignmentType,
      questionsToGenerate,
      assignmentId: assignmentIdNumber,
    } = body;

    if (!fileContents && !learningObjectives) {
      throw new BadRequestException(
        "Either file contents or learning objectives are required"
      );
    }
    if (Number.isNaN(assignmentIdNumber)) {
      throw new BadRequestException("Invalid assignment ID");
    }
    const userId = request.userSession.userId;
    if (typeof userId !== "string" || userId.trim() === "") {
      throw new BadRequestException("Invalid user ID");
    }

    const job = await this.assignmentService.createJob(
      assignmentIdNumber,
      userId
    );
    void this.assignmentService.handleFileContents(
      assignmentIdNumber,
      job.id,
      assignmentType,
      questionsToGenerate,
      fileContents,
      learningObjectives
    );

    return { message: "File processing started", jobId: job.id };
  }
}
