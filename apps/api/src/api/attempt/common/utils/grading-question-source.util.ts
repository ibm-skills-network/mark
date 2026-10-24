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

const parseJsonField = (field: unknown): unknown => {
  if (field === null || field === undefined || field === "") {
    return null;
  }
  if (typeof field === "string") {
    try {
      return JSON.parse(field) as unknown;
    } catch {
      // A stored value that is not JSON carries nothing usable.
      return null;
    }
  }
  return field;
};

/**
 * The question as an attempt pinned to an assignment version was shown it:
 * built from that version's QuestionVersion row, keyed by the original
 * question id so it lines up with `questionOrder` and submitted ids.
 */
export const questionDtoFromVersion = (
  questionVersion: QuestionVersion,
  assignmentId: number,
): QuestionDto => ({
  id: questionVersion.questionId ?? questionVersion.id,
  assignmentId,
  question: questionVersion.question,
  type: questionVersion.type,
  responseType: questionVersion.responseType ?? undefined,
  totalPoints: questionVersion.totalPoints,
  maxWords: questionVersion.maxWords ?? undefined,
  maxCharacters: questionVersion.maxCharacters ?? undefined,
  choices: (parseJsonField(questionVersion.choices) as Choice[]) ?? undefined,
  scoring: (parseJsonField(questionVersion.scoring) as ScoringDto) ?? undefined,
  answer: questionVersion.answer,
  randomizedChoices: questionVersion.randomizedChoices ?? undefined,
  gradingContextQuestionIds: questionVersion.gradingContextQuestionIds ?? [],
  videoPresentationConfig:
    (parseJsonField(
      questionVersion.videoPresentationConfig,
    ) as VideoPresentationConfig) ?? undefined,
  liveRecordingConfig:
    (parseJsonField(questionVersion.liveRecordingConfig) as object) ??
    undefined,
  isDeleted: false,
  alreadyInBackend: true,
});

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
  scoring: (parseJsonField(variant.scoring) as ScoringDto) ?? base.scoring,
  choices: (parseJsonField(variant.choices) as Choice[]) ?? base.choices,
  answer: variant.answer ?? base.answer,
});
