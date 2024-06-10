import { Injectable, NotFoundException } from "@nestjs/common";
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

@Injectable()
export class AssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService
  ) {}

  async findOne(
    id: number,
    userSession: UserSession
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
          result.questionOrder.indexOf(b.id)
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
        `Group with Id ${userSession.groupId} not found.`
      );
    }

    return results.map((result) => ({
      ...result.assignment,
    }));
  }

  async replace(
    id: number,
    replaceAssignmentDto: ReplaceAssignmentRequestDto
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
    updateAssignmentDto: UpdateAssignmentRequestDto
  ): Promise<BaseAssignmentResponseDto> {
    //emforce questionOrder when publishing
    if (updateAssignmentDto.published) {
      // Generate grading context for questions when publishing the assignment
      await this.handleQuestionGradingContext(
        id,
        updateAssignmentDto.questionOrder
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

  private async handleQuestionGradingContext(
    assignmentId: number,
    questionOrder: number[]
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
        questionsForGradingContext
      );

    const updates = [];

    for (const [questionId, gradingContextQuestionIds] of Object.entries(
      questionGradingContextMap
    )) {
      updates.push(
        this.prisma.question.update({
          where: { id: Number.parseInt(questionId) },
          data: { gradingContextQuestionIds },
        })
      );
    }

    await Promise.all(updates);
  }
}
