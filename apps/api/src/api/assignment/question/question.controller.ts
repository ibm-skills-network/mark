import {
  BadRequestException,
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
  Res,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Response } from "express";
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
import {
  QuestionTranslationRequestDto,
  resolveSupportedLanguage,
} from "./dto/question-translation.request.dto";
import { AssignmentQuestionAccessControlGuard } from "./guards/assignment.question.access.control.guard";
import { UserThrottlerGuard } from "../../files/guards/user-throttler.guard";
import { QuestionService } from "./question.service";

@ApiTags("Questions")
@Injectable()
@Controller({
  path: "assignments/:assignmentId/questions",
  version: "2",
})
export class QuestionController {
  private logger: Logger;
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
  // Access first, so only requests that may translate count against the
  // per-user limit. Every miss is a paid LLM call.
  @UseGuards(AssignmentQuestionAccessControlGuard, UserThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: "Request a translation for a question" })
  @ApiBody({ type: QuestionTranslationRequestDto })
  @ApiResponse({ status: 201, type: Object })
  @ApiResponse({ status: 400, description: "Unsupported language code" })
  @ApiResponse({ status: 404, description: "Question not found" })
  @ApiResponse({ status: 429, description: "Too many translation requests" })
  @ApiResponse({
    status: 503,
    description: "Translation temporarily unavailable; retry after 1 s",
  })
  async getOrCreateTranslation(
    @Param("assignmentId") assignmentId: string,
    @Param("id") questionId: string,
    @Body() body: QuestionTranslationRequestDto,
    @Req() request: UserSessionRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{
    translatedQuestion: string;
    translatedChoices?: Choice[] | { id: number | null; choice: string }[];
  }> {
    const { userSession } = request;
    const logContext = {
      assignment_id: Number(assignmentId),
      question_id: Number(questionId),
      user_id: userSession.userId,
      role: userSession.role,
    };
    // The DTO has already refused codes outside the catalogue.
    const language = resolveSupportedLanguage(body.selectedLanguageCode);
    if (!language) {
      this.logger.warn("Question translation refused", {
        ...logContext,
        denial_reason: "unsupported_language",
      });
      throw new BadRequestException("Unsupported language");
    }
    this.logger.info("Question translation requested", {
      ...logContext,
      language_code: language.code,
    });

    const question = await this.questionService.findOneForTranslation(
      Number(questionId),
    );

    let translation: {
      translatedQuestion: string;
      translatedChoices?: Choice[];
    };
    try {
      translation = await this.questionService.generateTranslationIfNotExists(
        question.assignmentId,
        question,
        language,
      );
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) {
        response.setHeader("Retry-After", "1");
      }
      this.logger.warn("Question translation failed", {
        ...logContext,
        language_code: language.code,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    this.logger.info("Question translation served", {
      ...logContext,
      language_code: language.code,
    });

    const { translatedQuestion, translatedChoices } = translation;
    if (userSession.role === UserRole.LEARNER) {
      const safeChoices = translatedChoices?.map((choice) => ({
        id: typeof choice.id === "number" ? choice.id : null,
        choice: choice.choice,
      }));
      return { translatedQuestion, translatedChoices: safeChoices };
    }

    return { translatedQuestion, translatedChoices };
  }
}
