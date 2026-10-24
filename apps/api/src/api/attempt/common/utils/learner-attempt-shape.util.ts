import { Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  LearnerAttemptQuestionDto,
  LearnerChoiceDto,
  LearnerQuestionTranslationDto,
} from "../../dto/learner-attempt.response.dto";

const logger = new Logger("LearnerAttemptShape");

/**
 * What the attempt mapper hands over per question. Typed loosely on purpose:
 * stored JSON (choices, randomizedChoices, scoring) arrives in whatever shape
 * was persisted, and this module is the one place that pins it down.
 */
export interface MappedAttemptQuestion {
  id: number;
  question: string;
  type: string;
  responseType?: string | null;
  choices?: unknown;
  translations?: unknown;
  maxWords?: number | null;
  maxCharacters?: number | null;
  scoring?: unknown;
  totalPoints: number;
  assignmentId: number;
  gradingContextQuestionIds?: number[] | null;
  isDeleted?: boolean | null;
  randomizedChoices?: unknown;
  videoPresentationConfig?: unknown;
  liveRecordingConfig?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Stored JSON columns sometimes hold a JSON string of the real value. */
function parseStoredJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error: unknown) {
    // Not JSON: treat as absent rather than echoing raw text to the client.
    logger.debug(
      `Unparsable stored JSON on learner attempt read: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/**
 * Keep `{id, choice}`; add `isCorrect`/`feedback` only when the caller has
 * decided the answer key may be shown. `points` never survives.
 */
export function sanitizeLearnerChoices(
  raw: unknown,
  revealAnswers: boolean,
): LearnerChoiceDto[] {
  const parsed = parseStoredJson(raw);
  if (!Array.isArray(parsed)) return [];
  const out: LearnerChoiceDto[] = [];
  for (const entry of parsed as unknown[]) {
    if (!isRecord(entry)) continue;
    const { choice, id, isCorrect, feedback } = entry;
    if (typeof choice !== "string" && typeof choice !== "number") continue;
    const sanitized: LearnerChoiceDto = {
      id: typeof id === "number" ? id : null,
      choice: typeof choice === "number" ? String(choice) : choice,
    };
    if (revealAnswers) {
      if (typeof isCorrect === "boolean") sanitized.isCorrect = isCorrect;
      sanitized.feedback = typeof feedback === "string" ? feedback : null;
    }
    out.push(sanitized);
  }
  return out;
}

/** The frozen choice order, or null when the attempt has none. */
export function sanitizeRandomizedChoices(
  raw: unknown,
  revealAnswers: boolean,
): LearnerChoiceDto[] | null {
  const parsed = parseStoredJson(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const choices = sanitizeLearnerChoices(parsed, revealAnswers);
  return choices.length > 0 ? choices : null;
}

function sanitizeTranslations(
  raw: unknown,
  revealAnswers: boolean,
): Record<string, LearnerQuestionTranslationDto> {
  const out: Record<string, LearnerQuestionTranslationDto> = {};
  if (!isRecord(raw)) return out;
  for (const [code, value] of Object.entries(raw)) {
    if (!isRecord(value) || typeof value.translatedText !== "string") continue;
    const choices = parseStoredJson(value.translatedChoices);
    out[code] = {
      translatedText: value.translatedText,
      translatedChoices: Array.isArray(choices)
        ? sanitizeLearnerChoices(choices, revealAnswers)
        : null,
    };
  }
  return out;
}

/** Rubrics are the grading key; only shown when the author opted in. */
function sanitizeScoring(raw: unknown): Record<string, unknown> | undefined {
  const parsed = parseStoredJson(raw);
  if (!isRecord(parsed)) return undefined;
  const scoring: Record<string, unknown> = { ...parsed };
  if (scoring.showRubricsToLearner !== true) delete scoring.rubrics;
  return scoring;
}

function jsonOrNull(value: unknown): Prisma.JsonValue | null {
  const parsed = parseStoredJson(value);
  return isRecord(parsed) ? (parsed as Prisma.JsonObject) : null;
}

/**
 * Build a question for the learner attempt route key by key, so nothing the
 * mapper carries along (`answer`, variant ids, author comments) can leak.
 */
export function toLearnerAttemptQuestion(
  question: MappedAttemptQuestion,
  revealAnswers: boolean,
): LearnerAttemptQuestionDto {
  const shaped: LearnerAttemptQuestionDto = {
    id: question.id,
    question: question.question,
    type: question.type,
    responseType: question.responseType ?? null,
    choices: sanitizeLearnerChoices(question.choices, revealAnswers),
    translations: sanitizeTranslations(question.translations, revealAnswers),
    authorComment: null,
    totalPoints: question.totalPoints,
    assignmentId: question.assignmentId,
    gradingContextQuestionIds: question.gradingContextQuestionIds ?? [],
    isDeleted: question.isDeleted ?? false,
    randomizedChoices: sanitizeRandomizedChoices(
      question.randomizedChoices,
      revealAnswers,
    ),
    videoPresentationConfig: jsonOrNull(question.videoPresentationConfig),
    liveRecordingConfig: jsonOrNull(question.liveRecordingConfig),
  };
  if (typeof question.maxWords === "number") {
    shaped.maxWords = question.maxWords;
  }
  if (typeof question.maxCharacters === "number") {
    shaped.maxCharacters = question.maxCharacters;
  }
  const scoring = sanitizeScoring(question.scoring);
  if (scoring) shaped.scoring = scoring;
  return shaped;
}
