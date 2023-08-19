import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
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
  AdminCreateUpdateAssignmentSubmissionRequestDto,
  LearnerUpdateAssignmentSubmissionRequestDto,
} from "./dto/assignment-submission/create.update.assignment.submission.request.dto";
import { GetAssignmentSubmissionResponseDto } from "./dto/assignment-submission/get.assignment.submission.response.dto";
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
  @Roles(UserRole.LEARNER, UserRole.ADMIN)
  @UseGuards(AssignmentSubmissionAccessControlGuard)
  @ApiOperation({
    summary:
      "Create an assignment submission (can accept a body only if the role is admin)",
  })
  @ApiBody({ type: AdminCreateUpdateAssignmentSubmissionRequestDto })
  @ApiResponse({ status: 201, type: BaseAssignmentSubmissionResponseDto })
  createAssignmentSubmission(
    @Param("assignmentId") assignmentId: number,
    @Req() request: UserRequest,
    @Body()
    adminCreateUpdateAssignmentSubmissionRequestDto?: AdminCreateUpdateAssignmentSubmissionRequestDto
  ): Promise<BaseAssignmentSubmissionResponseDto> {
    // if the user role is learner then dont accept any body
    if (
      request.user.role === UserRole.LEARNER &&
      Object.keys(adminCreateUpdateAssignmentSubmissionRequestDto).length > 0
    ) {
      throw new ForbiddenException();
    }
    return this.submissionService.createAssignmentSubmission(
      Number(assignmentId),
      request.user,
      adminCreateUpdateAssignmentSubmissionRequestDto
    );
  }

  @Get(":submissionId")
  @Roles(UserRole.LEARNER, UserRole.AUTHOR, UserRole.ADMIN)
  @UseGuards(AssignmentSubmissionAccessControlGuard)
  @ApiOperation({ summary: "Get an assignment submission" })
  @ApiResponse({ status: 200, type: GetAssignmentSubmissionResponseDto })
  getAssignmentSubmission(
    @Param("submissionId") assignmentSubmissionID: number
  ): Promise<GetAssignmentSubmissionResponseDto> {
    return this.submissionService.getAssignmentSubmission(
      Number(assignmentSubmissionID)
    );
  }

  @Patch(":submissionId")
  @Roles(UserRole.LEARNER, UserRole.ADMIN)
  @UseGuards(AssignmentSubmissionAccessControlGuard)
  @ApiOperation({ summary: "Update an assignment submission" })
  @ApiExtraModels(
    LearnerUpdateAssignmentSubmissionRequestDto,
    AdminCreateUpdateAssignmentSubmissionRequestDto
  )
  @ApiBody({
    schema: {
      anyOf: refs(
        LearnerUpdateAssignmentSubmissionRequestDto,
        AdminCreateUpdateAssignmentSubmissionRequestDto
      ),
    },
  })
  @ApiResponse({ status: 201, type: BaseAssignmentSubmissionResponseDto })
  async updateAssignmentSubmission(
    @Param("submissionId") assignmentSubmissionID: number,
    @Param("assignmentId") assignmentId: number,
    @Body()
    updateAssignmentSubmissionDto:
      | LearnerUpdateAssignmentSubmissionRequestDto
      | AdminCreateUpdateAssignmentSubmissionRequestDto,
    @Req() request: UserRequest
  ): Promise<UpdateAssignmentSubmissionResponseDto> {
    const userRole = request.user.role;

    if (userRole === UserRole.LEARNER) {
      // Validate against Learner DTO
      const learnerUpdateSubmissionDto = plainToInstance(
        LearnerUpdateAssignmentSubmissionRequestDto,
        updateAssignmentSubmissionDto
      );
      await this.validateDto(learnerUpdateSubmissionDto);

      return this.submissionService.updateAssignmentSubmission(
        Number(assignmentSubmissionID),
        Number(assignmentId),
        userRole,
        learnerUpdateSubmissionDto
      );
    }

    if (userRole === UserRole.ADMIN) {
      // Validate against Admin DTO
      const adminUpdateSubmissionDto = plainToInstance(
        AdminCreateUpdateAssignmentSubmissionRequestDto,
        updateAssignmentSubmissionDto
      );
      await this.validateDto(adminUpdateSubmissionDto);

      return this.submissionService.updateAssignmentSubmission(
        Number(assignmentSubmissionID),
        Number(assignmentId),
        userRole,
        adminUpdateSubmissionDto
      );
    }
  }

  @Get(":submissionId/questions/")
  @Roles(UserRole.LEARNER, UserRole.ADMIN)
  @UseGuards(AssignmentSubmissionAccessControlGuard)
  @ApiOperation({ summary: "Get questions for an assignment submission." })
  @ApiResponse({
    status: 200,
    type: [GetAssignmentSubmissionQuestionResponseDto],
  })
  getAssignmentSubmissionQuestions(
    @Param("assignmentId") assignmentID: number
  ): Promise<GetAssignmentSubmissionQuestionResponseDto[]> {
    return this.submissionService.getAssignmentSubmissionQuestions(
      Number(assignmentID)
    );
  }

  @Post(":submissionId/questions/:questionId/responses")
  @Roles(UserRole.LEARNER, UserRole.ADMIN)
  @UseGuards(AssignmentSubmissionAccessControlGuard)
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
