import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import {
  UserRole,
  UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
import { Roles } from "../../../auth/role/roles.global.guard";
import { LearnerLiveRecordingFeedback } from "../attempt/dto/assignment-attempt/types";
import { ASSIGNMENT_SCHEMA_URL } from "../constants";
import {
  Choice,
  QuestionDto,
  ScoringDto,
} from "../dto/update.questions.request.dto";
import { BaseQuestionResponseDto } from "./dto/base.question.response.dto";
import { CreateUpdateQuestionRequestDto } from "./dto/create.update.question.request.dto";
import { GetQuestionResponseDto } from "./dto/get.question.response.dto";
import { AssignmentQuestionAccessControlGuard } from "./guards/assignment.question.access.control.guard";
import { QuestionService } from "./question.service";

@ApiTags("Questions")
@Injectable()
@Controller({
  path: "assignments/:assignmentId/questions",
  version: "2",
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
      question: QuestionDto;
      rubricIndex: number;
    },
    @Req() request: UserSessionRequest,
  ): Promise<ScoringDto | Choice[]> {
    const { question, rubricIndex } = body;
    return await this.questionService.createMarkingRubric(
      question,
      request.userSession.assignmentId,
      rubricIndex,
    );
  }

  @Post("expand-marking-rubric")
  @Roles(UserRole.AUTHOR)
  @ApiOperation({ summary: "Create marking rubric" })
  @ApiBody({
    type: Object,
    description: "Questions for creating marking rubric",
  })
  @ApiResponse({ status: 200, type: Object })
  async expandMarkingRubric(
    @Body()
    body: {
      question: QuestionDto;
    },
    @Req() request: UserSessionRequest,
  ): Promise<QuestionDto> {
    const { question } = body;
    return await this.questionService.expandMarkingRubric(
      question,
      request.userSession.assignmentId,
    );
  }

  @Post("/live-recording-feedback")
  @Roles(UserRole.AUTHOR, UserRole.LEARNER)
  @UseGuards(AssignmentQuestionAccessControlGuard)
  @ApiOperation({ summary: "Request feedback for a live recording" })
  @ApiBody({
    type: Object,
    description: "Provide the live recording data",
  })
  @ApiResponse({ status: 200, type: Object })
  @ApiResponse({ status: 404, description: "Question not found" })
  getLiveRecordingFeedback(
    @Param("assignmentId") assignmentId: number,
    @Body()
    body: {
      liveRecordingData: LearnerLiveRecordingFeedback;
    },
  ): Promise<{ feedback: string }> {
    const { liveRecordingData } = body;

    if (!liveRecordingData.question) {
      throw new NotFoundException(`Question not found or not provided.`);
    }
    return this.questionService.getLiveRecordingFeedback(
      liveRecordingData,
      Number(assignmentId),
    );
  }
  @Post(":id/translations")
  @Roles(UserRole.AUTHOR, UserRole.LEARNER)
  @UseGuards(AssignmentQuestionAccessControlGuard)
  @ApiOperation({ summary: "Request a translation for a question" })
  @ApiBody({
    type: Object,
    description:
      "Provide selectedLanguage and selectedLanguageCode for the translation request",
  })
  @ApiResponse({ status: 200, type: Object })
  @ApiResponse({ status: 404, description: "Question not found" })
  async getOrCreateTranslation(
    @Param("id") questionId: number,
    @Body()
    body: {
      selectedLanguage: string;
      selectedLanguageCode: string;
    },
    @Req() request: UserSessionRequest,
  ): Promise<{
    translatedQuestion: string;
    translatedChoices?: Choice[] | { id: number | null; choice: string }[];
  }> {
    const { selectedLanguage, selectedLanguageCode } = body;
    const { userSession } = request;

    const question = await this.questionService.findOneForTranslation(
      Number(questionId),
    );

    const { translatedQuestion, translatedChoices } =
      await this.questionService.generateTranslationIfNotExists(
        question.assignmentId,
        question,
        selectedLanguageCode,
        selectedLanguage,
      );

    if (userSession.role === UserRole.LEARNER) {
      const safeChoices = translatedChoices?.map((choice) => ({
        id: choice.id || null,
        choice: choice.choice,
      }));
      return { translatedQuestion, translatedChoices: safeChoices };
    }

    return { translatedQuestion, translatedChoices };
  }
}
