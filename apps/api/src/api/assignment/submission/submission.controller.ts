import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import {
  UserRequest,
  UserRole,
} from "../../..//auth/interfaces/user.interface";
import { Roles } from "../../../auth/role/roles.global.guard";
import {
  GRADE_SUBMISSION_EXCEPTION,
  MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
  MAX_RETRIES_QUESTION_EXCEPTION_MESSAGE,
  SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
} from "./api-exceptions/exceptions";
import { BaseAssignmentSubmissionResponseDto } from "./dto/assignment-submission/base.assignment.submission.response.dto";
import { LearnerUpdateAssignmentSubmissionRequestDto } from "./dto/assignment-submission/create.update.assignment.submission.request.dto";
import {
  AssignmentSubmissionResponseDto,
  GetAssignmentSubmissionResponseDto,
} from "./dto/assignment-submission/get.assignment.submission.response.dto";
import { UpdateAssignmentSubmissionResponseDto } from "./dto/assignment-submission/update.assignment.submission.response.dto";
import { CreateQuestionResponseSubmissionRequestDto } from "./dto/question-response/create.question.response.submission.request.dto";
import { CreateQuestionResponseSubmissionResponseDto } from "./dto/question-response/create.question.response.submission.response.dto";
import { GetAssignmentSubmissionQuestionResponseDto } from "./dto/question/get.assignment.submission.questions.response.dto";
import { AssignmentSubmissionAccessControlGuard } from "./guards/assignment.submission.access.control.guard";
import { SubmissionService } from "./submission.service";

@ApiTags(
  "Submissions (All the endpoints use a JWT Cookie named 'authentication' for authorization)"
)
@Injectable()
@Controller({
  path: "assignments/:assignmentId/submissions",
  version: "1",
})
export class SubmissionController {
  private logger;
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private parentLogger: Logger,
    private readonly submissionService: SubmissionService
  ) {
    this.logger = parentLogger.child({ context: SubmissionController.name });
  }

  @Post()
  @Roles(UserRole.LEARNER)
  @UseGuards(AssignmentSubmissionAccessControlGuard)
  @ApiOperation({
    summary: "Create an assignment submission for an assignment.",
  })
  @ApiResponse({ status: 201, type: BaseAssignmentSubmissionResponseDto })
  @ApiResponse({
    status: 422,
    type: String,
    description: MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
  })
  @ApiResponse({ status: 403 })
  createAssignmentSubmission(
    @Param("assignmentId") assignmentId: number,
    @Req() request: UserRequest
  ): Promise<BaseAssignmentSubmissionResponseDto> {
    return this.submissionService.createAssignmentSubmission(
      Number(assignmentId),
      request.user
    );
  }

  @Get()
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentSubmissionAccessControlGuard)
  @ApiOperation({ summary: "List assignment submissions for an assignment." })
  @ApiResponse({ status: 200, type: [AssignmentSubmissionResponseDto] })
  @ApiResponse({ status: 403 })
  listAssignmentSubmissions(
    @Param("assignmentId") assignmentId: number,
    @Req() request: UserRequest
  ): Promise<AssignmentSubmissionResponseDto[]> {
    return this.submissionService.listAssignmentSubmissions(
      Number(assignmentId),
      request.user
    );
  }

  @Get(":submissionId")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentSubmissionAccessControlGuard)
  @ApiOperation({ summary: "Get an assignment submission for an assignment." })
  @ApiResponse({ status: 200, type: GetAssignmentSubmissionResponseDto })
  @ApiResponse({ status: 403 })
  getAssignmentSubmission(
    @Param("submissionId") assignmentSubmissionID: number
  ): Promise<GetAssignmentSubmissionResponseDto> {
    return this.submissionService.getAssignmentSubmission(
      Number(assignmentSubmissionID)
    );
  }

  @Patch(":submissionId")
  @Roles(UserRole.LEARNER)
  @UseGuards(AssignmentSubmissionAccessControlGuard)
  @ApiOperation({
    summary: "Update an assignment submission for an assignment.",
  })
  @ApiBody({
    type: LearnerUpdateAssignmentSubmissionRequestDto,
    required: true,
  })
  @ApiResponse({ status: 201, type: BaseAssignmentSubmissionResponseDto })
  @ApiResponse({
    status: 422,
    type: String,
    description: SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
  })
  @ApiResponse({
    status: 500,
    type: String,
    description: GRADE_SUBMISSION_EXCEPTION,
  })
  @ApiResponse({ status: 403 })
  async updateAssignmentSubmission(
    @Param("submissionId") assignmentSubmissionID: number,
    @Param("assignmentId") assignmentId: number,
    @Body()
    learnerUpdateAssignmentSubmissionDto: LearnerUpdateAssignmentSubmissionRequestDto,
    @Req() request: Request
  ): Promise<UpdateAssignmentSubmissionResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const authCookie: string = request?.cookies?.authentication;
    return this.submissionService.updateAssignmentSubmission(
      Number(assignmentSubmissionID),
      Number(assignmentId),
      learnerUpdateAssignmentSubmissionDto,
      authCookie
    );
  }

  @Get(":submissionId/questions/")
  @Roles(UserRole.LEARNER)
  @UseGuards(AssignmentSubmissionAccessControlGuard)
  @ApiOperation({ summary: "Get questions for an assignment submission." })
  @ApiResponse({
    status: 200,
    type: [GetAssignmentSubmissionQuestionResponseDto],
  })
  @ApiResponse({ status: 403 })
  getAssignmentSubmissionQuestions(
    @Param("assignmentId") assignmentID: number
  ): Promise<GetAssignmentSubmissionQuestionResponseDto[]> {
    return this.submissionService.getAssignmentSubmissionQuestions(
      Number(assignmentID)
    );
  }

  @Post(":submissionId/questions/:questionId/responses")
  @Roles(UserRole.LEARNER)
  @UseGuards(AssignmentSubmissionAccessControlGuard)
  @UseInterceptors(FileInterceptor("learnerFileResponse"))
  @ApiOperation({
    summary: "Create a question response for a question in an assignment.",
  })
  @ApiBody({ type: CreateQuestionResponseSubmissionRequestDto })
  @ApiResponse({
    status: 200,
    type: CreateQuestionResponseSubmissionResponseDto,
  })
  @ApiResponse({
    status: 422,
    type: String,
    description: MAX_RETRIES_QUESTION_EXCEPTION_MESSAGE,
  })
  @ApiResponse({ status: 403 })
  createQuestionResponse(
    @Param("submissionId") assignmentSubmissionID: number,
    @Param("questionId") questionID: number,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    createQuestionResponseSubmissionRequestDto: CreateQuestionResponseSubmissionRequestDto
  ): Promise<CreateQuestionResponseSubmissionResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    createQuestionResponseSubmissionRequestDto.learnerFileResponse = file;

    return this.submissionService.createQuestionResponse(
      Number(assignmentSubmissionID),
      Number(questionID),
      createQuestionResponseSubmissionRequestDto
    );
  }
}
