import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  Post,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { BaseAssignmentSubmissionResponseDto } from "./dto/assignment-submission/base.assignment.submission.response.dto";
import { GetAssignmentSubmissionResponseDto } from "./dto/assignment-submission/get.assignment.submission.response.dto";
import { CreateQuestionResponseSubmissionRequestDto } from "./dto/question-response/create.question.response.submission.request.dto";
import { CreateQuestionResponseSubmissionResponseDto } from "./dto/question-response/create.question.response.submission.response.dto";
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

  //CRUD operations for assignment submissions responses

  @Post()
  @ApiOperation({ summary: "Create an assignment submission" })
  @ApiResponse({ status: 201, type: BaseAssignmentSubmissionResponseDto })
  createAssignmentSubmission(
    @Param("assignmentId") assignmentId: number
  ): Promise<BaseAssignmentSubmissionResponseDto> {
    return this.submissionService.createAssignmentSubmission(
      Number(assignmentId)
    );
  }

  @Get(":id")
  @ApiOperation({ summary: "Get an assignment submission" })
  @ApiResponse({ status: 200, type: GetAssignmentSubmissionResponseDto })
  getAssignmentSubmission(
    @Param("id") assignmentSubmissionID: number
  ): Promise<GetAssignmentSubmissionResponseDto> {
    return this.submissionService.getAssignmentSubmission(
      Number(assignmentSubmissionID)
    );
  }

  //CRUD operations for question responses

  @Post(":submissionId/questions/:questionId/responses")
  @ApiOperation({
    summary: "Create a question response for a question in an assignment",
  })
  @ApiBody({ type: CreateQuestionResponseSubmissionRequestDto })
  @ApiResponse({
    status: 200,
    type: CreateQuestionResponseSubmissionResponseDto,
  })
  createQuestionResponse(
    @Param("assignmentId") assignmentID: number,
    @Param("submissionId") assignmentSubmissionID: number,
    @Param("questionId") questionID: number,
    @Body()
    createQuestionResponseSubmissionRequestDto: CreateQuestionResponseSubmissionRequestDto
  ): Promise<CreateQuestionResponseSubmissionResponseDto> {
    return this.submissionService.createQuestionResponse(
      Number(assignmentSubmissionID),
      Number(questionID),
      createQuestionResponseSubmissionRequestDto
    );
  }
}
