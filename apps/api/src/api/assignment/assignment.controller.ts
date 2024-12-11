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
  refs,
} from "@nestjs/swagger";
import { Prisma, Question, QuestionType, ReportType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { interval, Observable } from "rxjs";
import { map, mergeMap } from "rxjs/operators";
import { Logger } from "winston";
import {
  UserRole,
  UserSessionRequest,
} from "../../auth/interfaces/user.session.interface";
import { Roles } from "../../auth/role/roles.global.guard";
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
  "Assignments (All endpoints need a user-session header (injected using the API Gateway)",
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
  @ApiResponse({ status: 403 })
  async getAssignment(
    @Param("id") id: number,
    @Req() request: UserSessionRequest,
  ): Promise<GetAssignmentResponseDto | LearnerGetAssignmentResponseDto> {
    const backendData = await this.assignmentService.findOne(
      Number(id),
      request.userSession,
    );
    return {
      ...backendData,
      alreadyInBackend: true,
    };
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
    @Req() request: UserSessionRequest,
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
    @Body() updateAssignmentRequestDto: UpdateAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    return this.assignmentService.update(
      Number(id),
      updateAssignmentRequestDto,
    );
  }
  @Put(":id/questions")
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
    @Body() updateAssignmentQuestionsDto: UpdateAssignmentQuestionsDto,
  ): Promise<UpdateAssignmentQuestionsResponseDto> {
    return this.assignmentService.updateAssignmentQuestions(
      Number(id),
      updateAssignmentQuestionsDto,
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
    @Body() generateQuestionVariantDto: GenerateQuestionVariantDto,
  ): Promise<
    BaseAssignmentResponseDto & {
      questions?: QuestionDto[];
    }
  > {
    return this.assignmentService.generateVariantsFromQuestions(
      Number(id),
      generateQuestionVariantDto,
    );
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
    @Body() replaceAssignmentRequestDto: ReplaceAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    return this.assignmentService.replace(
      Number(id),
      replaceAssignmentRequestDto,
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
      map((data) => ({ data }) as MessageEvent),
    );
  }
  @Post(":assignmentId/upload-files")
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
    @Req() request: UserSessionRequest,
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
        "Either file contents or learning objectives are required",
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
      userId,
    );
    void this.assignmentService.handleFileContents(
      assignmentIdNumber,
      job.id,
      assignmentType,
      questionsToGenerate,
      fileContents,
      learningObjectives,
    );

    return { message: "File processing started", jobId: job.id };
  }
}
