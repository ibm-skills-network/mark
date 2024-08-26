import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, QuestionType } from "@prisma/client";
import {
  UserRole,
  type UserSession,
} from "../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../prisma.service";
import { LlmService } from "../llm/llm.service";
import type { BaseAssignmentResponseDto } from "./dto/base.assignment.response.dto";
import type {
  AssignmentResponseDto,
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "./dto/get.assignment.response.dto";
import type { ReplaceAssignmentRequestDto } from "./dto/replace.assignment.request.dto";
import type { UpdateAssignmentRequestDto } from "./dto/update.assignment.request.dto";
import { UpdateAssignmentQuestionsDto } from "./dto/update.questions.request.dto";
import { CreateUpdateQuestionRequestDto } from "./question/dto/create.update.question.request.dto";

@Injectable()
export class AssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  async findOne(
    id: number,
    userSession: UserSession,
  ): Promise<GetAssignmentResponseDto | LearnerGetAssignmentResponseDto> {
    const isLearner = userSession.role === UserRole.LEARNER;

    const result = await this.prisma.assignment.findUnique({
      where: { id },
      include: { questions: !isLearner },
    });

    if (!result) {
      throw new NotFoundException(`Assignment with Id ${id} not found.`);
    }

    // If learner then get rid of irrelevant/sensitive fields like questions, displayOrder and questionOrder
    if (isLearner) {
      result.displayOrder = undefined;
      result.questionOrder = undefined;
      return {
        ...result,
        success: true,
      } as LearnerGetAssignmentResponseDto;
    }

    // sort the questions
    if (result.questions && result.questionOrder) {
      result.questions.sort(
        (a, b) =>
          result.questionOrder.indexOf(a.id) -
          result.questionOrder.indexOf(b.id),
      );
    }

    return {
      ...result,
      success: true,
    } as GetAssignmentResponseDto;
  }

  async list(userSession: UserSession): Promise<AssignmentResponseDto[]> {
    const results = await this.prisma.assignmentGroup.findMany({
      where: { groupId: userSession.groupId },
      include: {
        assignment: true,
      },
    });

    if (!results) {
      throw new NotFoundException(
        `Group with Id ${userSession.groupId} not found.`,
      );
    }

    return results.map((result) => ({
      ...result.assignment,
    }));
  }

  async replace(
    id: number,
    replaceAssignmentDto: ReplaceAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    const result = await this.prisma.assignment.update({
      where: { id },
      data: {
        ...this.createEmptyDto(),
        ...replaceAssignmentDto,
      },
    });

    return {
      id: result.id,
      success: true,
    };
  }

  async update(
    id: number,
    updateAssignmentDto: UpdateAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    if (updateAssignmentDto.published && updateAssignmentDto.questionOrder) {
      // Generate grading context for questions when publishing the assignment
      await this.handleQuestionGradingContext(
        id,
        updateAssignmentDto.questionOrder,
      );
    }

    const result = await this.prisma.assignment.update({
      where: { id },
      data: updateAssignmentDto,
    });

    return {
      id: result.id,
      success: true,
    };
  }
  async updateAssignmentQuestions(
    assignmentId: number,
    updateAssignmentQuestionsDto: UpdateAssignmentQuestionsDto,
  ): Promise<BaseAssignmentResponseDto> {
    const { questions } = updateAssignmentQuestionsDto;

    // Fetch existing questions for the assignment
    const existingQuestions = await this.prisma.question.findMany({
      where: { assignmentId },
    });

    // Track all processed IDs to identify which existing questions need to be deleted
    const processedIds = new Set<number>();

    await Promise.all(
      questions.map(async (question) => {
        const questionData: Prisma.QuestionUpsertArgs["create"] = {
          choices: question.choices
            ? (JSON.parse(
                JSON.stringify(question.choices),
              ) as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          scoring: question.scoring
            ? (JSON.parse(
                JSON.stringify(question.scoring),
              ) as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          answer: question.answer ?? false, // Ensure answer is provided or default to false
          type: question.type as QuestionType, // Cast type correctly to QuestionType
          totalPoints: question.totalPoints,
          question: question.question,
          maxWords: question.maxWords,
          maxCharacters: question.maxCharacters,
          assignment: {
            connect: {
              id: assignmentId,
            },
          },
        };

        await this.applyGuardRails(
          questionData as unknown as CreateUpdateQuestionRequestDto,
        );

        // Upsert the question (update if it exists, create if it doesn't)
        const upsertedQuestion = await this.prisma.question.upsert({
          where: { id: question.id },
          update: {
            ...questionData,
          },
          create: questionData,
        });

        // Mark this ID as processed
        processedIds.add(upsertedQuestion.id);
      }),
    );

    // Delete questions that were not processed (i.e., they were not included in the incoming DTO)
    const questionsToDelete = existingQuestions
      .filter((q) => !processedIds.has(q.id))
      .map((q) => q.id);

    if (questionsToDelete.length > 0) {
      await this.prisma.question.deleteMany({
        where: { id: { in: questionsToDelete } },
      });
    }

    return {
      id: assignmentId,
      success: true,
    };
  }

  // private methods
  private createEmptyDto(): Partial<ReplaceAssignmentRequestDto> {
    /* eslint-disable unicorn/no-null */
    return {
      instructions: null,
      numAttempts: null,
      allotedTimeMinutes: null,
      attemptsPerTimeRange: null,
      attemptsTimeRangeHours: null,
      displayOrder: null,
    };
  }

  private async applyGuardRails(
    createUpdateQuestionRequestDto: CreateUpdateQuestionRequestDto,
  ): Promise<void> {
    const guardRailsValidation = await this.llmService.applyGuardRails(
      JSON.stringify(createUpdateQuestionRequestDto),
    );
    if (!guardRailsValidation) {
      throw new HttpException(
        "Question validation failed due to inappropriate or unacceptable content",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async handleQuestionGradingContext(
    assignmentId: number,
    questionOrder: number[],
  ) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { questions: true },
    });

    const questionsForGradingContext = assignment.questions
      .sort((a, b) => questionOrder.indexOf(a.id) - questionOrder.indexOf(b.id))
      .map((q) => ({
        id: q.id,
        questionText: q.question,
      }));

    const questionGradingContextMap =
      await this.llmService.generateQuestionGradingContext(
        questionsForGradingContext,
      );

    const updates = [];

    for (const [questionId, gradingContextQuestionIds] of Object.entries(
      questionGradingContextMap,
    )) {
      updates.push(
        this.prisma.question.update({
          where: { id: Number.parseInt(questionId) },
          data: { gradingContextQuestionIds },
        }),
      );
    }

    await Promise.all(updates);
  }
}
