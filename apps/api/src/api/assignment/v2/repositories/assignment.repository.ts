import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  Assignment,
  AssignmentVersion,
  Prisma,
  Question,
  QuestionVariant,
} from "@prisma/client";
import { applyQuestionOrder } from "src/api/assignment/utils/question-order.util";
import { DEFAULT_PASSING_GRADE } from "src/api/attempt/common/utils/pass-fail.util";
import {
  UserRole,
  UserSession,
} from "src/auth/interfaces/user.session.interface";
import { PrismaService } from "src/database/prisma.service";
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
  "showPassFailIndicator",
  "correctAnswerVisibility",
  "questionControls",
  "requireAllQuestions",
  "optionalQuestionIds",
  "languageCode",
] as const;

type FieldKey = (typeof FIELDS)[number];

/** Typed defaults for overlapping fields */
const DEFAULTS = {
  attemptsBeforeCoolDown: 1,
  retakeAttemptCoolDownMinutes: 5,
  passingGrade: DEFAULT_PASSING_GRADE,
  questionDisplay: "ONE_PER_PAGE",
  graded: false,
  numAttempts: -1,
  showAssignmentScore: true,
  showQuestionScore: true,
  showSubmissionFeedback: true,
  showQuestions: true,
  showPassFailIndicator: false,
  requireAllQuestions: false,
  optionalQuestionIds: [],
} as const satisfies Partial<Record<FieldKey, unknown>>;

/** `questionControls` is a JSON object; tolerate one stored as JSON text. */
function learnerQuestionControls(
  value: Prisma.JsonValue | null,
): Prisma.JsonObject | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      // Unparsable text carries no controls; the learner view shows none.
      return null;
    }
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Prisma.JsonObject)
    : null;
}

/**
 * The learner view of an assignment. Everything merges version -> base ->
 * defaults except the attempt and time limits, `published` and
 * `showAssignmentScore`, which are read from the base row: attempt creation
 * and grade visibility enforce the base row, so showing the version's values
 * would promise behaviour the server does not apply.
 */
function buildLearnerAssignment(
  base: Assignment,
  version: AssignmentVersion | null,
): LearnerGetAssignmentResponseDto {
  return {
    id: base.id,
    name: prefer(version?.name, base.name) ?? base.name,
    introduction: prefer(version?.introduction, base.introduction),
    instructions: prefer(version?.instructions, base.instructions),
    gradingCriteriaOverview: prefer(
      version?.gradingCriteriaOverview,
      base.gradingCriteriaOverview,
    ),
    timeEstimateMinutes: prefer(
      version?.timeEstimateMinutes,
      base.timeEstimateMinutes,
    ),
    attemptsBeforeCoolDown:
      base.attemptsBeforeCoolDown ?? DEFAULTS.attemptsBeforeCoolDown,
    // Create enforces no cooldown for a null value, so the learner sees 0.
    retakeAttemptCoolDownMinutes: base.retakeAttemptCoolDownMinutes ?? 0,
    type: prefer(version?.type, base.type) ?? base.type,
    graded: prefer(version?.graded, base.graded) ?? DEFAULTS.graded,
    numAttempts: base.numAttempts ?? DEFAULTS.numAttempts,
    allotedTimeMinutes: base.allotedTimeMinutes ?? null,
    requireAllQuestions:
      prefer(version?.requireAllQuestions, base.requireAllQuestions) ??
      DEFAULTS.requireAllQuestions,
    optionalQuestionIds: prefer(
      version?.optionalQuestionIds,
      base.optionalQuestionIds,
    ) ?? [...DEFAULTS.optionalQuestionIds],
    attemptsPerTimeRange: base.attemptsPerTimeRange ?? null,
    attemptsTimeRangeHours: base.attemptsTimeRangeHours ?? null,
    passingGrade:
      prefer(version?.passingGrade, base.passingGrade) ?? DEFAULTS.passingGrade,
    displayOrder: prefer(version?.displayOrder, base.displayOrder),
    questionDisplay:
      prefer(version?.questionDisplay, base.questionDisplay) ??
      DEFAULTS.questionDisplay,
    numberOfQuestionsPerAttempt: base.numberOfQuestionsPerAttempt ?? null,
    questionOrder: version?.questionOrder?.length
      ? version.questionOrder
      : (base.questionOrder ?? []),
    published: base.published ?? false,
    showAssignmentScore:
      base.showAssignmentScore ?? DEFAULTS.showAssignmentScore,
    showQuestionScore:
      prefer(version?.showQuestionScore, base.showQuestionScore) ??
      DEFAULTS.showQuestionScore,
    showSubmissionFeedback:
      prefer(version?.showSubmissionFeedback, base.showSubmissionFeedback) ??
      DEFAULTS.showSubmissionFeedback,
    showQuestions:
      prefer(version?.showQuestions, base.showQuestions) ??
      DEFAULTS.showQuestions,
    showPassFailIndicator:
      prefer(version?.showPassFailIndicator, base.showPassFailIndicator) ??
      DEFAULTS.showPassFailIndicator,
    correctAnswerVisibility:
      prefer(version?.correctAnswerVisibility, base.correctAnswerVisibility) ??
      base.correctAnswerVisibility,
    questionControls: learnerQuestionControls(
      prefer(version?.questionControls, base.questionControls),
    ),
    updatedAt: base.updatedAt,
    languageCode: prefer(version?.languageCode, base.languageCode),
    currentVersionId: base.currentVersionId ?? null,
    success: true,
  };
}

/** Safe coalescer */
function prefer<T>(...vals: Array<T | null | undefined>): T | null {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return null;
}

export interface AssignmentMeta {
  id: number;
  name: string | null;
  introduction: string | null;
  instructions: string | null;
  gradingCriteriaOverview: string | null;
}

/**
 * Which version is live: the one the assignment points at while it is still
 * active, otherwise the newest active version.
 *
 * Assignments published before versioning — and any whose 2025 backfill failed,
 * since that migration swallowed per-row errors — have neither, and fall back to
 * the base row. Shared by every read so "what the learner sees" has one answer.
 */
function pickActiveVersion<T extends { isActive: boolean }>(
  currentVersion: T | null | undefined,
  activeVersions: readonly T[] | null | undefined,
): T | null {
  return (
    (currentVersion?.isActive ? currentVersion : null) ??
    (activeVersions?.length ? activeVersions[0] : null)
  );
}

/**
 * Prisma `select` fragment carrying everything needed to resolve the live title
 * inside a bulk query, so a listing does not need a follow-up read per row.
 * Spread it into a `select` and pass each row to `resolveAssignmentName`.
 *
 * `versions` is the fallback arm of `pickActiveVersion` and is filtered to the
 * single newest active row; `@@unique([assignmentId, versionNumber])` makes the
 * per-assignment lookup an index seek.
 */
export const ASSIGNMENT_NAME_SELECT = {
  name: true,
  currentVersion: { select: { isActive: true, name: true } },
  versions: {
    where: { isActive: true },
    orderBy: { id: "desc" },
    take: 1,
    select: { isActive: true, name: true },
  },
} as const;

/**
 * Like {@link ASSIGNMENT_NAME_SELECT} but carrying all four text fields, for
 * callers that render more than the title. Kept separate because introductions
 * are long, and a listing that only prints names should not drag them across.
 */
export const ASSIGNMENT_META_SELECT = {
  name: true,
  introduction: true,
  instructions: true,
  gradingCriteriaOverview: true,
  currentVersion: {
    select: {
      isActive: true,
      name: true,
      introduction: true,
      instructions: true,
      gradingCriteriaOverview: true,
    },
  },
  versions: {
    where: { isActive: true },
    orderBy: { id: "desc" },
    take: 1,
    select: {
      isActive: true,
      name: true,
      introduction: true,
      instructions: true,
      gradingCriteriaOverview: true,
    },
  },
} as const;

interface VersionTextRow {
  isActive: boolean;
  name?: string | null;
  introduction?: string | null;
  instructions?: string | null;
  gradingCriteriaOverview?: string | null;
}

/** A row selected with {@link ASSIGNMENT_NAME_SELECT} or {@link ASSIGNMENT_META_SELECT}. */
export interface AssignmentTextRow {
  name?: string | null;
  introduction?: string | null;
  instructions?: string | null;
  gradingCriteriaOverview?: string | null;
  currentVersion?: VersionTextRow | null;
  versions?: readonly VersionTextRow[] | null;
}

/**
 * The assignment's live title: the active version's, falling back to the base
 * row. Same rule as {@link AssignmentRepository.findMetaById}, for callers that
 * read in bulk and only need the name.
 */
export function resolveAssignmentName(row: AssignmentTextRow): string | null {
  const activeVersion = pickActiveVersion(row.currentVersion, row.versions);
  return prefer(activeVersion?.name, row.name);
}

/** As {@link resolveAssignmentName}, for all four author-written fields. */
export function resolveAssignmentMeta(
  row: AssignmentTextRow,
): Omit<AssignmentMeta, "id"> {
  const activeVersion = pickActiveVersion(row.currentVersion, row.versions);
  return {
    name: prefer(activeVersion?.name, row.name),
    introduction: prefer(activeVersion?.introduction, row.introduction),
    instructions: prefer(activeVersion?.instructions, row.instructions),
    gradingCriteriaOverview: prefer(
      activeVersion?.gradingCriteriaOverview,
      row.gradingCriteriaOverview,
    ),
  };
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
    if (userSession?.role === UserRole.LEARNER) {
      return this.findLearnerView(id);
    }

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

    const activeVersion = pickActiveVersion(
      result.currentVersion,
      result.versions,
    );

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
            authorComment: qv.authorComment ?? legacy?.authorComment ?? null,
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
   * Learner read: only the scalar columns the contract lists. Version rows
   * carry every question's answer key, so they are read without their
   * question versions and never returned.
   */
  private async findLearnerView(
    id: number,
  ): Promise<LearnerGetAssignmentResponseDto> {
    const result = await this.prisma.assignment.findUnique({
      where: { id },
      include: {
        currentVersion: true,
        versions: {
          where: { isActive: true },
          orderBy: { id: "desc" },
          take: 1,
        },
      },
    });

    if (!result) {
      throw new NotFoundException(`Assignment with Id ${id} not found.`);
    }

    const { currentVersion, versions, ...base } = result;
    return buildLearnerAssignment(
      base,
      pickActiveVersion(currentVersion, versions),
    );
  }

  /**
   * The assignment's author-written text as a learner actually sees it: the
   * active version's values, falling back to the base row.
   *
   * Exists because the base `Assignment` row is not that text. Publishing writes
   * the name into the version only, so a caller reading `assignment.name`
   * directly gets whatever the title was before versioning was introduced —
   * which is how the translator ended up translating a title nobody is shown.
   *
   * Narrow on purpose: `findById` loads every version, question and variant,
   * which is far more than a name lookup needs. Both resolve the live version
   * the same way, so what gets translated is what gets served.
   *
   * @param id - Assignment ID
   * @returns The merged text fields, or null if the assignment does not exist
   */
  async findMetaById(id: number): Promise<AssignmentMeta | null> {
    const result = await this.prisma.assignment.findUnique({
      where: { id },
      select: { id: true, ...ASSIGNMENT_META_SELECT },
    });

    if (!result) {
      return null;
    }

    return { id: result.id, ...resolveAssignmentMeta(result) };
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

      return authoredAssignments as AssignmentResponseDto[];
    }

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
    })) as AssignmentResponseDto[];
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

    assignment.questions = applyQuestionOrder(
      filteredQuestions,
      assignment.questionOrder,
    );
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
