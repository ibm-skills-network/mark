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
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import {
  UserRole,
  UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
import { Roles } from "../../../auth/role/roles.global.guard";
import {
  GRADE_SUBMISSION_EXCEPTION,
  MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
  MAX_RETRIES_QUESTION_EXCEPTION_MESSAGE,
  SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
} from "./api-exceptions/exceptions";
import { AttemptService } from "./attempt.service";
import { BaseAssignmentAttemptResponseDto } from "./dto/assignment-attempt/base.assignment.attempt.response.dto";
import { LearnerUpdateAssignmentAttemptRequestDto } from "./dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import {
  AssignmentAttemptResponseDto,
  GetAssignmentAttemptResponseDto,
} from "./dto/assignment-attempt/get.assignment.attempt.response.dto";
import { UpdateAssignmentAttemptResponseDto } from "./dto/assignment-attempt/update.assignment.attempt.response.dto";
import { CreateQuestionResponseAttemptRequestDto } from "./dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "./dto/question-response/create.question.response.attempt.response.dto";
import { GetAssignmentAttemptQuestionResponseDto } from "./dto/question/get.assignment.attempt.questions.response.dto";
import { AssignmentAttemptAccessControlGuard } from "./guards/assignment.attempt.access.control.guard";

@ApiTags("Attempts")
@Injectable()
@Controller({
  path: "assignments/:assignmentId/attempts",
  version: "1",
})
export class AttemptController {
  private logger;
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private parentLogger: Logger,
    private readonly attemptService: AttemptService
  ) {
    this.logger = parentLogger.child({ context: AttemptController.name });
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
  @ApiResponse({ status: 403 })
  createAssignmentAttempt(
    @Param("assignmentId") assignmentId: number,
    @Req() request: UserSessionRequest
  ): Promise<BaseAssignmentAttemptResponseDto> {
    return this.attemptService.createAssignmentAttempt(
      Number(assignmentId),
      request.userSession
    );
  }

  @Get()
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "List assignment attempts for an assignment." })
  @ApiResponse({ status: 200, type: [AssignmentAttemptResponseDto] })
  @ApiResponse({ status: 403 })
  listAssignmentAttempts(
    @Param("assignmentId") assignmentId: number,
    @Req() request: UserSessionRequest
  ): Promise<AssignmentAttemptResponseDto[]> {
    return this.attemptService.listAssignmentAttempts(
      Number(assignmentId),
      request.userSession
    );
  }

  @Get(":attemptId")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "Get an assignment attempt for an assignment." })
  @ApiResponse({ status: 200, type: GetAssignmentAttemptResponseDto })
  @ApiResponse({ status: 403 })
  getAssignmentAttempt(
    @Param("attemptId") assignmentAttemptID: number
  ): Promise<GetAssignmentAttemptResponseDto> {
    return this.attemptService.getAssignmentAttempt(
      Number(assignmentAttemptID)
    );
  }

  @Patch(":attemptId")
  @Roles(UserRole.LEARNER)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({
    summary: "Update an assignment attempt for an assignment.",
  })
  @ApiBody({
    type: LearnerUpdateAssignmentAttemptRequestDto,
    required: true,
  })
  @ApiResponse({ status: 201, type: BaseAssignmentAttemptResponseDto })
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
  async updateAssignmentAttempt(
    @Param("attemptId") assignmentAttemptID: number,
    @Param("assignmentId") assignmentId: number,
    @Body()
    learnerUpdateAssignmentAttemptDto: LearnerUpdateAssignmentAttemptRequestDto,
    @Req() request: UserSessionRequest
  ): Promise<UpdateAssignmentAttemptResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const authCookie: string = request?.cookies?.authentication;
    const gradingCallbackRequired =
      request?.userSession.gradingCallbackRequired ?? false;
    return this.attemptService.updateAssignmentAttempt(
      Number(assignmentAttemptID),
      Number(assignmentId),
      learnerUpdateAssignmentAttemptDto,
      authCookie,
      gradingCallbackRequired
    );
  }

  @Get(":attemptId/questions/")
  @Roles(UserRole.LEARNER)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @ApiOperation({ summary: "Get questions for an assignment attempt." })
  @ApiResponse({
    status: 200,
    type: [GetAssignmentAttemptQuestionResponseDto],
  })
  @ApiResponse({ status: 403 })
  getAssignmentAttemptQuestions(
    @Param("assignmentId") assignmentID: number
  ): Promise<GetAssignmentAttemptQuestionResponseDto[]> {
    return this.attemptService.getAssignmentAttemptQuestions(
      Number(assignmentID)
    );
  }

  @Post(":attemptId/questions/:questionId/responses")
  @Roles(UserRole.LEARNER)
  @UseGuards(AssignmentAttemptAccessControlGuard)
  @UseInterceptors(FileInterceptor("learnerFileResponse"))
  @ApiOperation({
    summary: "Create a question response for a question in an assignment.",
  })
  @ApiBody({ type: CreateQuestionResponseAttemptRequestDto })
  @ApiResponse({
    status: 200,
    type: CreateQuestionResponseAttemptResponseDto,
  })
  @ApiResponse({
    status: 422,
    type: String,
    description: MAX_RETRIES_QUESTION_EXCEPTION_MESSAGE,
  })
  @ApiResponse({ status: 403 })
  createQuestionResponse(
    @Param("attemptId") assignmentAttemptID: number,
    @Param("questionId") questionID: number,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    createQuestionResponseAttemptRequestDto.learnerFileResponse = file;

    return this.attemptService.createQuestionResponse(
      Number(assignmentAttemptID),
      Number(questionID),
      createQuestionResponseAttemptRequestDto
    );
  }
}
