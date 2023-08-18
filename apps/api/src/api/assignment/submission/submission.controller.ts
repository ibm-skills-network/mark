import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import {
  ApiBody,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
  refs,
} from "@nestjs/swagger";
import { plainToInstance } from "class-transformer";
import { validateOrReject, ValidationError } from "class-validator";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import {
  UserRequest,
  UserRole,
} from "../../..//auth/interfaces/user.interface";
import { Roles } from "../../../auth/role/roles.global.guard";
import { BaseAssignmentSubmissionResponseDto } from "./dto/assignment-submission/base.assignment.submission.response.dto";
import {
  AdminCreateAnswerSubmissionRequestDto,
  LearnerCreateAnswerSubmissionRequestDto,
} from "./dto/assignment-submission/create.assignment.submission.request.dto copy";
import { GetAssignmentSubmissionResponseDto } from "./dto/assignment-submission/get.assignment.submission.response.dto";
import {
  AdminUpdateAnswerSubmissionRequestDto,
  LearnerUpdateAnswerSubmissionRequestDto,
} from "./dto/assignment-submission/update.assignment.submission.request.dto";
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
  @Roles(UserRole.LEARNER, UserRole.ADMIN)
  @ApiOperation({ summary: "Create an assignment submission" })
  @ApiBody({
    schema: {
      anyOf: refs(
        LearnerCreateAnswerSubmissionRequestDto,
        AdminCreateAnswerSubmissionRequestDto
      ),
    },
  })
  @ApiResponse({ status: 201, type: BaseAssignmentSubmissionResponseDto })
  createAssignmentSubmission(
    @Param("assignmentId") assignmentId: number
  ): Promise<BaseAssignmentSubmissionResponseDto> {
    return this.submissionService.createAssignmentSubmission(
      Number(assignmentId)
    );
  }

  @Get(":id")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR, UserRole.ADMIN)
  @ApiOperation({ summary: "Get an assignment submission" })
  @ApiResponse({ status: 200, type: GetAssignmentSubmissionResponseDto })
  getAssignmentSubmission(
    @Param("id") assignmentSubmissionID: number
  ): Promise<GetAssignmentSubmissionResponseDto> {
    return this.submissionService.getAssignmentSubmission(
      Number(assignmentSubmissionID)
    );
  }

  @Patch(":id")
  @Roles(UserRole.LEARNER, UserRole.ADMIN)
  @ApiOperation({ summary: "Update an assignment submission" })
  @ApiExtraModels(
    LearnerUpdateAnswerSubmissionRequestDto,
    AdminUpdateAnswerSubmissionRequestDto
  )
  @ApiBody({
    schema: {
      anyOf: refs(
        LearnerUpdateAnswerSubmissionRequestDto,
        AdminUpdateAnswerSubmissionRequestDto
      ),
    },
  })
  @ApiResponse({ status: 201, type: BaseAssignmentSubmissionResponseDto })
  async updateAssignmentSubmission(
    @Param("id") assignmentSubmissionID: number,
    @Param("assignmentId") assignmentId: number,
    @Body()
    updateAssignmentSubmissionDto:
      | LearnerUpdateAnswerSubmissionRequestDto
      | AdminUpdateAnswerSubmissionRequestDto,
    @Req() request: UserRequest
  ): Promise<BaseAssignmentSubmissionResponseDto> {
    const userRole = request.user.role;

    if (userRole === UserRole.LEARNER) {
      // Validate against Learner DTO
      const learnerUpdateSubmissionDto = plainToInstance(
        LearnerUpdateAnswerSubmissionRequestDto,
        updateAssignmentSubmissionDto
      );
      await this.validateDto(learnerUpdateSubmissionDto);

      return this.submissionService.updateAssignmentSubmission(
        Number(assignmentSubmissionID),
        Number(assignmentId),
        learnerUpdateSubmissionDto
      );
    }

    if (userRole === UserRole.ADMIN) {
      // Validate against Admin DTO
      const adminUpdateSubmissionDto = plainToInstance(
        AdminUpdateAnswerSubmissionRequestDto,
        updateAssignmentSubmissionDto
      );
      await this.validateDto(adminUpdateSubmissionDto);

      return this.submissionService.updateAssignmentSubmission(
        Number(assignmentSubmissionID),
        Number(assignmentId),
        adminUpdateSubmissionDto
      );
    }
  }

  //CRUD operations for question responses

  @Post(":submissionId/questions/:questionId/responses")
  @Roles(UserRole.LEARNER, UserRole.ADMIN)
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

  // Helper methods
  private async validateDto(dto: object): Promise<void> {
    console.log(dto);
    try {
      await validateOrReject(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      // eslint-disable-next-line unicorn/catch-error-name
    } catch (errors) {
      const errorMessages = (errors as ValidationError[]).map(
        (error: ValidationError) =>
          Object.values(error.constraints ?? {}).join(", ")
      );

      throw new BadRequestException(errorMessages);
    }
  }
}
