import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  Assignment,
  AssignmentQuestionDisplayOrder,
  Question,
  QuestionVariant,
} from "@prisma/client";
import {
  UserSession,
  UserRole,
} from "src/auth/interfaces/user.session.interface";
import { PrismaService } from "src/prisma.service";
import {
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
  AssignmentResponseDto,
} from "../../dto/get.assignment.response.dto";
import {
  QuestionDto,
  ScoringDto,
  Choice,
  VariantDto,
  VideoPresentationConfig,
} from "../../dto/update.questions.request.dto";

/**
 * Repository for Assignment data access operations
 */
@Injectable()
export class AssignmentRepository {
  private readonly logger = new Logger(AssignmentRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find assignment by ID with related data
   *
   * @param id - Assignment ID
   * @param userSession - Optional user session for role-based access
   * @returns Assignment data formatted based on user role
   */

  async findById(
    id: number,
    userSession?: UserSession,
  ): Promise<GetAssignmentResponseDto | LearnerGetAssignmentResponseDto> {
    const isLearner = userSession?.role === UserRole.LEARNER;

    const result = await this.prisma.assignment.findUnique({
      where: { id },
      include: {
        questions: {
          include: { variants: true },
        },
      },
    });

    if (!result) {
      throw new NotFoundException(`Assignment with Id ${id} not found.`);
    }

    const processedAssignment = this.processAssignmentData(result);

    if (isLearner) {
      return {
        ...processedAssignment,
        success: true,
        questions: undefined,
      } as LearnerGetAssignmentResponseDto;
    }

    return {
      ...processedAssignment,
      success: true,
      questions:
        processedAssignment.questions?.map((q) => ({
          ...q,
          alreadyInBackend: true,
        })) || [],
    } as unknown as GetAssignmentResponseDto;
  }

  /**
   * Find all assignments for a specific user
   *
   * @param userSession - User session containing role and group info
   * @returns Array of assignment summaries
   */

  async findAllForUser(
    userSession: UserSession,
  ): Promise<AssignmentResponseDto[]> {
    const results = await this.prisma.assignmentGroup.findMany({
      where: { groupId: userSession.groupId },
      include: {
        assignment: true,
      },
    });

    if (!results || results.length === 0) {
      return [];
    }

    return results.map((result) => ({
      ...result.assignment,
    }));
  }

  /**
   * Update an assignment
   *
   * @param id - Assignment ID
   * @param data - Data to update
   * @returns Updated assignment
   */
  async update(id: number, data: Partial<Assignment>): Promise<Assignment> {
    try {
      return await this.prisma.assignment.update({
        where: { id },
        data,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack =
        error instanceof Error ? error.stack : "No stack trace";
      this.logger.error(
        `Error updating assignment ${id}: ${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }

  /**
   * Replace an assignment (full update)
   *
   * @param id - Assignment ID
   * @param data - New assignment data
   * @returns Updated assignment
   */
  async replace(id: number, data: Partial<Assignment>): Promise<Assignment> {
    try {
      return await this.prisma.assignment.update({
        where: { id },
        data: {
          ...this.createEmptyDto(),
          ...data,
        },
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack =
        error instanceof Error ? error.stack : "No stack trace";
      this.logger.error(
        `Error replacing assignment ${id}: ${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }

  /**
   * Process raw assignment data to filter deleted items and parse JSON
   *
   * @param rawAssignment - Raw assignment data from database (with questions and variants)
   * @returns Processed assignment data
   */
  private processAssignmentData(
    rawAssignment: Assignment & {
      questions: (Question & { variants: QuestionVariant[] })[];
    },
  ): Assignment & { questions: QuestionDto[] } {
    const assignment = JSON.parse(
      JSON.stringify(rawAssignment),
    ) as Assignment & { questions: QuestionDto[] };

    const questions = Array.isArray(assignment.questions)
      ? assignment.questions
      : [];

    const filteredQuestions = questions
      .filter((q) => !q.isDeleted)
      .map((q) => {
        const questionDto: QuestionDto = {
          ...q,
          variants: [],
          scoring: this.parseJsonField<ScoringDto>(q.scoring),
          choices: this.parseJsonField<Choice[]>(q.choices),
          videoPresentationConfig: this.parseJsonField<VideoPresentationConfig>(
            q.videoPresentationConfig,
          ),
        };

        if (Array.isArray(q.variants)) {
          questionDto.variants = q.variants
            .filter((v) => !v.isDeleted)
            .map((v) => {
              const variant: VariantDto = {
                ...v,
                choices: this.parseJsonField<Choice[]>(v.choices),
                scoring: this.parseJsonField<ScoringDto>(v.scoring),
              };
              return variant;
            });
        }

        return questionDto;
      });

    if (
      filteredQuestions.length > 0 &&
      Array.isArray(assignment.questionOrder)
    ) {
      filteredQuestions.sort(
        (a, b) =>
          assignment.questionOrder.indexOf(a.id) -
          assignment.questionOrder.indexOf(b.id),
      );
    }

    assignment.questions = filteredQuestions;
    return assignment as Assignment & { questions: QuestionDto[] };
  }

  /**
   * Parse JSON string fields into objects with type safety
   *
   * @param jsonValue - The JSON value to parse
   * @returns Parsed object of type T or undefined
   */
  private parseJsonField<T>(jsonValue: unknown): T | undefined {
    if (typeof jsonValue === "string") {
      try {
        return JSON.parse(jsonValue) as T;
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        const errorStack =
          error instanceof Error ? error.stack : "No stack trace";
        this.logger.error(
          `Error parsing JSON field: ${errorMessage}`,
          errorStack,
        );
        return undefined;
      }
    }

    if (jsonValue === null) {
      return undefined;
    }

    return jsonValue as T;
  }

  /**
   * Create an empty DTO for assignment replacement
   *
   * @returns Empty assignment data template
   */
  private createEmptyDto(): Partial<Assignment> {
    return {
      instructions: undefined,
      numAttempts: undefined,
      allotedTimeMinutes: undefined,
      attemptsPerTimeRange: undefined,
      attemptsTimeRangeHours: undefined,
      displayOrder: undefined as unknown as AssignmentQuestionDisplayOrder,
    };
  }
}
