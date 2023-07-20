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
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { BaseQuestionResponseDto } from "./dto/base.question.response.dto";
import { CreateUpdateQuestionRequestDto } from "./dto/create.update.question.request.dto";
import { GetQuestionResponseDto } from "./dto/get.question.response.dto";
import { GradeQuestionRequestDto } from "./dto/grade.question.request.dto";
import { GradeQuestionResponseDto } from "./dto/grade.question.response.dto";
import { QuestionService } from "./question.service";

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

  //CRUD operations

  @Post()
  @Version("1")
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
  getQuestion(@Param("id") id: number): Promise<GetQuestionResponseDto> {
    return this.questionService.findOne(Number(id));
  }

  @Patch(":id")
  @Version("1")
  updateQuestion(
    @Param("assignmentId") assignmentId: number,
    @Param("id") id: number,
    @Body() updateQuestionRequestDto: CreateUpdateQuestionRequestDto
  ) {
    return this.questionService.update(
      Number(assignmentId),
      Number(id),
      updateQuestionRequestDto
    );
  }

  @Put(":id")
  @Version("1")
  repalceQuestion(
    @Param("assignmentId") assignmentId: number,
    @Param("id") id: number,
    @Body() updateQuestionRequestDto: CreateUpdateQuestionRequestDto
  ) {
    return this.questionService.replace(
      Number(assignmentId),
      Number(id),
      updateQuestionRequestDto
    );
  }

  @Delete(":id")
  @Version("1")
  deleteQuestion(@Param("id") id: number) {
    return this.questionService.remove(Number(id));
  }

  // Grading operations

  @Post(":id/grade")
  @Version("1")
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
