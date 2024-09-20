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
import { UserRole } from "../../..//auth/interfaces/user.session.interface";
import { Roles } from "../../../auth/role/roles.global.guard";
import { ASSIGNMENT_SCHEMA_URL } from "../constants";
import { QuestionDto } from "../dto/update.questions.request.dto";
import { BaseQuestionResponseDto } from "./dto/base.question.response.dto";
import { CreateUpdateQuestionRequestDto } from "./dto/create.update.question.request.dto";
import { GetQuestionResponseDto } from "./dto/get.question.response.dto";
import { AssignmentQuestionAccessControlGuard } from "./guards/assignment.question.access.control.guard";
import { QuestionService } from "./question.service";

@ApiTags("Questions")
@Injectable()
@Controller({
  path: "assignments/:assignmentId/questions",
  version: "1",
})
export class QuestionController {
  private logger;
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private parentLogger: Logger,
    private readonly questionService: QuestionService,
  ) {
    this.logger = parentLogger.child({ context: QuestionController.name });
  }

  @Post()
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentQuestionAccessControlGuard)
  @ApiOperation({ summary: "Create a question" })
  @ApiBody({
    type: CreateUpdateQuestionRequestDto,
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({ status: 201, type: BaseQuestionResponseDto })
  @ApiResponse({ status: 403 })
  createQuestion(
    @Param("assignmentId") assignmentId: number,
    @Body() createQuestionRequestDto: CreateUpdateQuestionRequestDto,
  ): Promise<BaseQuestionResponseDto> {
    return this.questionService.create(
      Number(assignmentId),
      createQuestionRequestDto,
    );
  }

  @Get(":id")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentQuestionAccessControlGuard)
  @ApiOperation({ summary: "Get a question" })
  @ApiResponse({ status: 200, type: GetQuestionResponseDto })
  @ApiResponse({ status: 403 })
  getQuestion(@Param("id") id: number): Promise<QuestionDto> {
    return this.questionService.findOne(Number(id));
  }

  @Patch(":id")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentQuestionAccessControlGuard)
  @ApiOperation({ summary: "Update a question" })
  @ApiBody({
    type: CreateUpdateQuestionRequestDto,
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({ status: 200, type: BaseQuestionResponseDto })
  @ApiResponse({ status: 403 })
  updateQuestion(
    @Param("assignmentId") assignmentId: number,
    @Param("id") id: number,
    @Body() updateQuestionRequestDto: CreateUpdateQuestionRequestDto,
  ): Promise<BaseQuestionResponseDto> {
    return this.questionService.update(
      Number(assignmentId),
      Number(id),
      updateQuestionRequestDto,
    );
  }

  @Put(":id")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentQuestionAccessControlGuard)
  @ApiOperation({ summary: "Replace a question" })
  @ApiBody({
    type: CreateUpdateQuestionRequestDto,
    description: `[See full example of schema here](${ASSIGNMENT_SCHEMA_URL})`,
  })
  @ApiResponse({ status: 200, type: BaseQuestionResponseDto })
  @ApiResponse({ status: 403 })
  replaceQuestion(
    @Param("assignmentId") assignmentId: number,
    @Param("id") id: number,
    @Body() updateQuestionRequestDto: CreateUpdateQuestionRequestDto,
  ): Promise<BaseQuestionResponseDto> {
    return this.questionService.replace(
      Number(assignmentId),
      Number(id),
      updateQuestionRequestDto,
    );
  }

  @Delete(":id")
  @Roles(UserRole.AUTHOR)
  @UseGuards(AssignmentQuestionAccessControlGuard)
  @ApiOperation({ summary: "Delete a question" })
  @ApiResponse({ status: 200, type: BaseQuestionResponseDto })
  @ApiResponse({ status: 403 })
  deleteQuestion(@Param("id") id: number): Promise<BaseQuestionResponseDto> {
    return this.questionService.remove(Number(id));
  }

  @Post("generate-question-variations")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Generate question variations" })
  @ApiBody({
    type: Object,
    description: "Outline and concepts for question variations",
  })
  @ApiResponse({ status: 200, type: [String] })
  async generateQuestionVariations(
    @Body() body: { outline: string; concepts: string[] },
  ): Promise<string[]> {
    const { outline, concepts } = body;
    return await this.questionService.generateQuestionVariations(
      outline,
      concepts,
    );
  }

  @Post("create-marking-rubric")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Create marking rubric" })
  @ApiBody({
    type: Object,
    description: "Questions for creating marking rubric",
  })
  @ApiResponse({ status: 200, type: Object })
  async createMarkingRubric(
    @Body()
    body: {
      questions: { id: number; questionText: string; questionType: string }[];
    },
  ): Promise<Record<number, string>> {
    const { questions } = body;
    return await this.questionService.createMarkingRubric(questions);
  }
}
