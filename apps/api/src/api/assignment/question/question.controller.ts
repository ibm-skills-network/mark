import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { UserRole } from "../../..//auth/interfaces/user.interface";
import { Roles } from "../../../auth/role/roles.global.guard";
import { ASSIGNMENT_SCHEMA_URL } from "../constants";
import { BaseQuestionResponseDto } from "./dto/base.question.response.dto";
import { CreateUpdateQuestionRequestDto } from "./dto/create.update.question.request.dto";
import { GetQuestionResponseDto } from "./dto/get.question.response.dto";
import { AssignmentQuestionAccessControlGuard } from "./guards/assignment.question.access.control.guard";
import { QuestionService } from "./question.service";

@ApiTags(
  "Questions (All the endpoints use a JWT Cookie named 'authentication' for authorization)"
)
@Injectable()
@Controller({
  path: "assignments/:assignmentId/questions",
  version: "1",
})
export class QuestionController {
  private logger;
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private parentLogger: Logger,
    private readonly questionService: QuestionService
  ) {
    this.logger = parentLogger.child({ context: QuestionController.name });
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.AUTHOR)
  @UseGuards(AssignmentQuestionAccessControlGuard)
  @ApiOperation({ summary: "Create a question" })
  @ApiBody({
    type: CreateUpdateQuestionRequestDto,
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({ status: 201, type: BaseQuestionResponseDto })
  createQuestion(
    @Param("assignmentId") assignmentId: number,
    @Body() createQuestionRequestDto: CreateUpdateQuestionRequestDto
  ): Promise<BaseQuestionResponseDto> {
    return this.questionService.create(
      Number(assignmentId),
      createQuestionRequestDto
    );
  }

  @Get(":id")
  @Roles(UserRole.ADMIN, UserRole.AUTHOR)
  @UseGuards(AssignmentQuestionAccessControlGuard)
  @ApiOperation({ summary: "Get a question" })
  @ApiResponse({ status: 200, type: GetQuestionResponseDto })
  getQuestion(@Param("id") id: number): Promise<GetQuestionResponseDto> {
    return this.questionService.findOne(Number(id));
  }

  @Patch(":id")
  @Roles(UserRole.ADMIN, UserRole.AUTHOR)
  @UseGuards(AssignmentQuestionAccessControlGuard)
  @ApiOperation({ summary: "Update a question" })
  @ApiBody({
    type: CreateUpdateQuestionRequestDto,
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({ status: 200, type: BaseQuestionResponseDto })
  updateQuestion(
    @Param("assignmentId") assignmentId: number,
    @Param("id") id: number,
    @Body() updateQuestionRequestDto: CreateUpdateQuestionRequestDto
  ): Promise<BaseQuestionResponseDto> {
    return this.questionService.update(
      Number(assignmentId),
      Number(id),
      updateQuestionRequestDto
    );
  }

  @Put(":id")
  @Roles(UserRole.ADMIN, UserRole.AUTHOR)
  @UseGuards(AssignmentQuestionAccessControlGuard)
  @ApiOperation({ summary: "Replace a question" })
  @ApiBody({
    type: CreateUpdateQuestionRequestDto,
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({ status: 200, type: BaseQuestionResponseDto })
  replaceQuestion(
    @Param("assignmentId") assignmentId: number,
    @Param("id") id: number,
    @Body() updateQuestionRequestDto: CreateUpdateQuestionRequestDto
  ): Promise<BaseQuestionResponseDto> {
    return this.questionService.replace(
      Number(assignmentId),
      Number(id),
      updateQuestionRequestDto
    );
  }

  @Delete(":id")
  @Roles(UserRole.ADMIN, UserRole.AUTHOR)
  @UseGuards(AssignmentQuestionAccessControlGuard)
  @ApiOperation({ summary: "Delete a question" })
  @ApiResponse({ status: 200, type: BaseQuestionResponseDto })
  deleteQuestion(@Param("id") id: number): Promise<BaseQuestionResponseDto> {
    return this.questionService.remove(Number(id));
  }
}
