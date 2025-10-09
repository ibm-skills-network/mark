import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Assignment, Question, QuestionVariant } from "@prisma/client";
import {
  UserRole,
  UserSession,
} from "../../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../../prisma.service";
import {
  AssignmentResponseDto,
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "../../dto/get.assignment.response.dto";
import {
  Choice,
  QuestionDto,
  ScoringDto,
  VariantDto,
  VideoPresentationConfig,
} from "../../dto/update.questions.request.dto";

/** Fields we want to merge from activeVersion → assignment → defaults */
const FIELDS = [
  "name",
  "introduction",
  "instructions",
  "gradingCriteriaOverview",
  "timeEstimateMinutes",
  "attemptsBeforeCoolDown",
  "retakeAttemptCoolDownMinutes",
  "type",
  "graded",
  "numAttempts",
  "allotedTimeMinutes",
  "attemptsPerTimeRange",
  "attemptsTimeRangeHours",
  "passingGrade",
  "displayOrder",
  "questionDisplay",
  "numberOfQuestionsPerAttempt",
  "published",
  "showAssignmentScore",
  "showQuestionScore",
  "showSubmissionFeedback",
  "showQuestions",
  "languageCode",
] as const;

type FieldKey = (typeof FIELDS)[number];

/** Typed defaults for overlapping fields */
const DEFAULTS: Partial<Record<FieldKey, unknown>> = {
  attemptsBeforeCoolDown: 1,
  retakeAttemptCoolDownMinutes: 5,
  passingGrade: 50,
  questionDisplay: "ONE_PER_PAGE",
  graded: false,
  numAttempts: -1,
  showAssignmentScore: true,
  showQuestionScore: true,
  showSubmissionFeedback: true,
  showQuestions: true,
};

/** Safe coalescer */
function prefer<T>(...vals: Array<T | null | undefined>): T | null {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return null;
}

/** Merge whitelisted fields from primary → secondary → defaults */
function mergeFields(
  keys: readonly FieldKey[],
  primary?: Partial<Record<FieldKey, unknown>>,
  secondary?: Partial<Record<FieldKey, unknown>>,
  defaults?: Partial<Record<FieldKey, unknown>>,
): Partial<Record<FieldKey, unknown>> {
  const out: Partial<Record<FieldKey, unknown>> = {};
  for (const k of keys) {
    out[k] = prefer(primary?.[k], secondary?.[k], defaults?.[k]);
  }
  return out;
}

@Injectable()
export class AssignmentRepository {
  private readonly logger = new Logger(AssignmentRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(
    id: number,
    userSession?: UserSession,
  ): Promise<GetAssignmentResponseDto | LearnerGetAssignmentResponseDto> {
    const isLearner = userSession?.role === UserRole.LEARNER;

    const result = await this.prisma.assignment.findUnique({
      where: { id },
      include: {
        currentVersion: { include: { questionVersions: true } },
        versions: {
          where: { isActive: true },
          include: { questionVersions: true },
          orderBy: { id: "desc" },
          take: 1,
        },
        questions: {
          where: { isDeleted: false },
          include: { variants: true },
        },
      },
    });

    if (!result) {
      throw new NotFoundException(`Assignment with Id ${id} not found.`);
    }

    const activeVersion =
      (result.currentVersion?.isActive ? result.currentVersion : null) ??
      (result.versions?.length ? result.versions[0] : null);

    let processedAssignment: Assignment & { questions: QuestionDto[] };

    if (activeVersion) {
      const mappedQuestions: (Question & { variants: QuestionVariant[] })[] = [
        ...(activeVersion.questionVersions ?? []),
      ]
        .sort((a, b) => {
          const ao = a.displayOrder ?? 0;
          const bo = b.displayOrder ?? 0;
          return ao === bo ? a.id - b.id : ao - bo;
        })
        .map((qv) => {
          const legacy = qv.questionId
            ? result.questions.find((q) => q.id === qv.questionId)
            : undefined;

          const q: Question & { variants: QuestionVariant[] } = {
            id: qv.questionId ?? -qv.id,
            assignmentId: result.id,
            isDeleted: false,
            totalPoints: qv.totalPoints,
            type: qv.type,
            responseType: qv.responseType ?? null,
            question: qv.question,
            maxWords: qv.maxWords ?? null,
            scoring: qv.scoring ?? null,
            choices: qv.choices ?? null,
            randomizedChoices: qv.randomizedChoices ?? null,
            answer: qv.answer ?? null,
            gradingContextQuestionIds: qv.gradingContextQuestionIds ?? [],
            maxCharacters: qv.maxCharacters ?? null,
            videoPresentationConfig: qv.videoPresentationConfig ?? null,
            liveRecordingConfig: qv.liveRecordingConfig ?? null,
            variants: legacy?.variants ?? [],
          };
          return q;
        });

      const merged = mergeFields(FIELDS, activeVersion, result, DEFAULTS);

      const composed: Assignment & {
        questions: (Question & { variants: QuestionVariant[] })[];
      } = {
        ...(result as Assignment),
        ...(merged as Partial<Assignment>),
        questionOrder:
          (activeVersion.questionOrder?.length
            ? activeVersion.questionOrder
            : result.questionOrder) ?? [],
        questions: mappedQuestions,
      };

      processedAssignment = this.processAssignmentData(composed);
    } else {
      processedAssignment = this.processAssignmentData(result);
    }

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
        })) ?? [],
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
    // If user is an author, only show assignments they've authored
    if (userSession.role === UserRole.AUTHOR) {
      const authoredAssignments = await this.prisma.assignment.findMany({
        where: {
          AssignmentAuthor: {
            some: {
              userId: userSession.userId,
            },
          },
        },
      });

      return authoredAssignments;
    }

    // For non-authors (learners, admins), show assignments from their group
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
      attemptsBeforeCoolDown: undefined,
      retakeAttemptCoolDownMinutes: undefined,
      displayOrder: undefined,
    };
  }
}
