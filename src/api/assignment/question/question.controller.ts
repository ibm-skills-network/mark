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
  Version,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { BaseQuestionResponseDto } from "./dto/base.question.response.dto";
import { CreateUpdateQuestionRequestDto } from "./dto/create.update.question.request.dto";
import { GetQuestionResponseDto } from "./dto/get.question.response.dto";
import { GradeQuestionRequestDto } from "./dto/grade.question.request.dto";
import { GradeQuestionResponseDto } from "./dto/grade.question.response.dto";
import { QuestionService } from "./question.service";

@ApiTags(
  "Questions (All the endpoints use a JWT Cookie named 'authentication' for authorization)"
)
@Injectable()
@Controller("assignments/:assignmentId/questions")
export class QuestionController {
  private logger;
  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private parentLogger: Logger,
    private readonly questionService: QuestionService
  ) {
    this.logger = parentLogger.child({ context: QuestionController.name });
  }

  @Post()
  @Version("1")
  @ApiOperation({ summary: "Create a question" })
  @ApiBody({ type: CreateUpdateQuestionRequestDto })
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
  @Version("1")
  @ApiOperation({ summary: "Get a question" })
  @ApiResponse({ status: 200, type: GetQuestionResponseDto })
  getQuestion(@Param("id") id: number): Promise<GetQuestionResponseDto> {
    return this.questionService.findOne(Number(id));
  }

  @Patch(":id")
  @Version("1")
  @ApiOperation({ summary: "Update a question" })
  @ApiBody({ type: CreateUpdateQuestionRequestDto })
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
  @Version("1")
  @ApiOperation({ summary: "Replace a question" })
  @ApiBody({ type: CreateUpdateQuestionRequestDto })
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
  @Version("1")
  @ApiOperation({ summary: "Delete a question" })
  @ApiResponse({ status: 200, type: BaseQuestionResponseDto })
  deleteQuestion(@Param("id") id: number): Promise<BaseQuestionResponseDto> {
    return this.questionService.remove(Number(id));
  }

  @Post(":id/grade")
  @Version("1")
  @ApiOperation({ summary: "Grade a question" })
  @ApiBody({ type: GradeQuestionRequestDto })
  @ApiResponse({ status: 200, type: GradeQuestionResponseDto })
  gradeQuestion(
    @Param("id") id: number,
    @Body() gradeExerciseRequestDto: GradeQuestionRequestDto
  ): Promise<GradeQuestionResponseDto> {
    return this.questionService.gradeQuestion(
      Number(id),
      gradeExerciseRequestDto
    );
  }
}
