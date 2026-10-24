import { Logger } from "@nestjs/common";
import { QuestionVariant, QuestionVersion, ResponseType } from "@prisma/client";
import {
  Choice,
  QuestionDto,
  ScoringDto,
  VideoPresentationConfig,
} from "src/api/assignment/dto/update.questions.request.dto";

/**
 * Response types whose recorder/uploader flows are no longer graded. A served
 * question of one of these types is left out of grading, out of the grade's
 * denominator and out of "answer every question" checks.
 */
export const MEDIA_RESPONSE_TYPES: ReadonlySet<string> = new Set<string>([
  ResponseType.PRESENTATION,
  ResponseType.VIDEO,
  ResponseType.AUDIO,
  ResponseType.LIVE_RECORDING,
]);

export const isMediaResponseType = (
  responseType: string | null | undefined,
): boolean =>
  typeof responseType === "string" && MEDIA_RESPONSE_TYPES.has(responseType);

const logger = new Logger("GradingQuestionSource");

/** Which stored row a JSON field came from, for the corrupt-data warning. */
interface JsonFieldSource {
  field: string;
  questionId: number | null;
  questionVersionId?: number;
  variantId?: number;
}

const parseJsonField = (field: unknown, source: JsonFieldSource): unknown => {
  if (field === null || field === undefined || field === "") {
    return null;
  }
  if (typeof field === "string") {
    try {
      return JSON.parse(field) as unknown;
    } catch (error: unknown) {
      // A stored value that is not JSON carries nothing usable; grading goes
      // on without it, but the row needs fixing.
      logger.warn("grading.question_source.corrupt_json", {
        ...source,
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  return field;
};

/**
 * Marks a question built from a version row that names no source question.
 * Its id is the version row's own id, which can equal an unrelated live
 * question's id, so it must never be used to look up translations.
 */
const VERSION_ONLY = Symbol("versionOnlyQuestion");

type MaybeVersionOnly = QuestionDto & { [VERSION_ONLY]?: true };

/**
 * True for a question whose id is not a real question id (see VERSION_ONLY).
 * The mark survives spreading, so variant-applied copies keep it.
 */
export const isVersionOnlyQuestion = (question: QuestionDto): boolean =>
  (question as MaybeVersionOnly)[VERSION_ONLY] === true;

/**
 * The question as an attempt pinned to an assignment version was shown it:
 * built from that version's QuestionVersion row, keyed by the original
 * question id so it lines up with `questionOrder` and submitted ids.
 */
export const questionDtoFromVersion = (
  questionVersion: QuestionVersion,
  assignmentId: number,
): QuestionDto => {
  const source = (field: string): JsonFieldSource => ({
    field,
    questionId: questionVersion.questionId,
    questionVersionId: questionVersion.id,
  });
  const dto: MaybeVersionOnly = {
    id: questionVersion.questionId ?? questionVersion.id,
    assignmentId,
    question: questionVersion.question,
    type: questionVersion.type,
    responseType: questionVersion.responseType ?? undefined,
    totalPoints: questionVersion.totalPoints,
    maxWords: questionVersion.maxWords ?? undefined,
    maxCharacters: questionVersion.maxCharacters ?? undefined,
    choices:
      (parseJsonField(
        questionVersion.choices,
        source("choices"),
      ) as Choice[]) ?? undefined,
    scoring:
      (parseJsonField(
        questionVersion.scoring,
        source("scoring"),
      ) as ScoringDto) ?? undefined,
    answer: questionVersion.answer,
    randomizedChoices: questionVersion.randomizedChoices ?? undefined,
    gradingContextQuestionIds: questionVersion.gradingContextQuestionIds ?? [],
    videoPresentationConfig:
      (parseJsonField(
        questionVersion.videoPresentationConfig,
        source("videoPresentationConfig"),
      ) as VideoPresentationConfig) ?? undefined,
    liveRecordingConfig:
      (parseJsonField(
        questionVersion.liveRecordingConfig,
        source("liveRecordingConfig"),
      ) as object) ?? undefined,
    isDeleted: false,
    alreadyInBackend: true,
  };
  if (questionVersion.questionId === null) {
    logger.warn("grading.question_source.version_without_question", {
      questionVersionId: questionVersion.id,
      assignmentId,
    });
    dto[VERSION_ONLY] = true;
  }
  return dto;
};

/** Pinned question DTOs keyed by question id. */
export const pinnedQuestionMap = (
  questionVersions: QuestionVersion[],
  assignmentId: number,
): Map<number, QuestionDto> => {
  const map = new Map<number, QuestionDto>();
  for (const questionVersion of questionVersions) {
    const dto = questionDtoFromVersion(questionVersion, assignmentId);
    map.set(dto.id, dto);
  }
  return map;
};

/**
 * The attempt's drawn variant overrides the base question's content, word and
 * character limits, choices, scoring and answer; type, response type, points
 * and grading context stay the base question's.
 */
export const applyVariantToQuestion = (
  base: QuestionDto,
  variant: Pick<
    QuestionVariant,
    | "id"
    | "variantContent"
    | "maxWords"
    | "maxCharacters"
    | "scoring"
    | "choices"
    | "answer"
  >,
): QuestionDto => ({
  ...base,
  question: variant.variantContent,
  maxWords: variant.maxWords ?? base.maxWords,
  maxCharacters: variant.maxCharacters ?? base.maxCharacters,
  scoring:
    (parseJsonField(variant.scoring, {
      field: "scoring",
      questionId: base.id,
      variantId: variant.id,
    }) as ScoringDto) ?? base.scoring,
  choices:
    (parseJsonField(variant.choices, {
      field: "choices",
      questionId: base.id,
      variantId: variant.id,
    }) as Choice[]) ?? base.choices,
  answer: variant.answer ?? base.answer,
});
