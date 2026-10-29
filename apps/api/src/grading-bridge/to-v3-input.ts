import { QuestionType } from "@prisma/client";
import type { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { parseJsonField } from "src/api/attempt/common/utils/grading-question-source.util";
import type { GradingContext } from "src/api/attempt/common/interfaces/grading-context.interface";
import type {
  GradingEffort,
  GradingQuestion,
  GradingQuestionContext,
  RubricCriterion,
} from "../v3/grading/contracts";
import { htmlToMarkdown, looksLikeHtml } from "../v3/grading/html-text";
import {
  abridgeText,
  MAX_PRIOR_ANSWERS,
  MAX_TOKENS_ASSIGNMENT_INSTRUCTIONS,
  MAX_TOKENS_PER_PRIOR_ANSWER,
} from "../v3/grading/limits";
import type {
  SubmissionFile,
  SubmissionSource,
} from "../v3/grading/materialize";

/** Rich text → light Markdown so lists, headings and code keep their shape. */
function plain(text: string): string {
  return looksLikeHtml(text) ? htmlToMarkdown(text) : text.trim();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown, field: string, questionId: number): unknown[] {
  const parsed =
    typeof value === "string"
      ? parseJsonField(value, { field, questionId })
      : value;
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Legacy scoring → v3 criteria. Each legacy rubric is one criterion; its
 * criteria are the levels, and the highest level is the maximum. Scoring,
 * rubrics and criteria may each be stored as JSON strings.
 */
export function rubricFromLegacy(question: QuestionDto): RubricCriterion[] {
  const scoringRaw: unknown = question.scoring;
  const scoring = asRecord(
    typeof scoringRaw === "string"
      ? parseJsonField(scoringRaw, {
          field: "scoring",
          questionId: question.id,
        })
      : scoringRaw,
  );
  const rubrics = asArray(scoring?.rubrics, "scoring.rubrics", question.id);
  const criteria: RubricCriterion[] = [];

  for (const [index, rawRubric] of rubrics.entries()) {
    const rubric = asRecord(
      typeof rawRubric === "string"
        ? (parseJsonField(rawRubric, {
            field: "scoring.rubric",
            questionId: question.id,
          }) ?? { rubricQuestion: rawRubric })
        : rawRubric,
    );
    if (!rubric) continue;
    const levels = asArray(
      rubric.criteria,
      "scoring.rubric.criteria",
      question.id,
    )
      .map((level) => asRecord(level))
      .filter((level): level is Record<string, unknown> => level !== undefined)
      .map((level) => ({
        points: Number(level.points),
        description: plain(String(level.description ?? "")),
      }))
      .filter((level) => Number.isFinite(level.points) && level.points >= 0);
    const description = plain(String(rubric.rubricQuestion ?? ""));
    if (!description && levels.length === 0) continue;
    criteria.push({
      id: `c${index + 1}`,
      description: description || `Criterion ${index + 1}`,
      maxPoints:
        levels.length > 0 ? Math.max(...levels.map((l) => l.points)) : 0,
      ...(levels.length > 0 ? { levels } : {}),
    });
  }

  const usable = criteria.filter((criterion) => criterion.maxPoints > 0);
  if (usable.length > 0) return usable;
  // No usable rubric: grade the question as a whole.
  return [
    {
      id: "c1",
      description:
        "How completely and correctly the submission answers the question.",
      maxPoints: question.totalPoints,
    },
  ];
}

/**
 * The assignment instructions and the learner's earlier answers legacy
 * grading gives the model, bounded; undefined when there are neither.
 */
export function contextFromLegacy(
  gradingContext: Pick<
    GradingContext,
    "assignmentInstructions" | "questionAnswerContext"
  >,
): GradingQuestionContext | undefined {
  const assignmentInstructions = abridgeText(
    plain(gradingContext.assignmentInstructions ?? ""),
    MAX_TOKENS_ASSIGNMENT_INSTRUCTIONS,
  );
  const priorAnswers = (gradingContext.questionAnswerContext ?? [])
    .slice(0, MAX_PRIOR_ANSWERS)
    .map((item) => ({
      question: abridgeText(
        plain(item.question ?? ""),
        MAX_TOKENS_PER_PRIOR_ANSWER,
      ),
      answer: abridgeText(
        plain(item.answer ?? ""),
        MAX_TOKENS_PER_PRIOR_ANSWER,
      ),
    }))
    .filter((item) => item.answer.length > 0);
  if (assignmentInstructions.length === 0 && priorAnswers.length === 0)
    return undefined;
  return { assignmentInstructions, priorAnswers };
}

const LANGUAGE_TAG = /^[a-z]{2,3}(-[\dA-Za-z]{2,8})*$/;
const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], {
  type: "language",
  fallback: "none",
});

/**
 * The attempt's language code (sent by the browser) as an English language
 * name for the prompt; English, as legacy defaults, when absent or unknown.
 */
export function feedbackLanguageName(code: string | undefined): string {
  if (!code || !LANGUAGE_TAG.test(code)) return "English";
  try {
    return LANGUAGE_NAMES.of(code) ?? "English";
  } catch {
    // A well-formed tag Intl still rejects: grade in the default language.
    return "English";
  }
}

export function toGradingQuestion(
  question: QuestionDto,
  effort: GradingEffort,
  context?: GradingQuestionContext,
  language?: string,
): GradingQuestion {
  return {
    questionId: question.id,
    questionType: question.type,
    questionText: plain(question.question ?? ""),
    rubric: { criteria: rubricFromLegacy(question) },
    totalPoints: question.totalPoints,
    effort,
    ...(context ? { context } : {}),
    feedbackLanguage: feedbackLanguageName(language),
  };
}

/** A stored file reference from either the file or the image strategy. */
interface LegacyFileReference {
  filename?: string;
  bucket?: string;
  key?: string;
  imageBucket?: string;
  imageKey?: string;
  fileType?: string;
  mimeType?: string;
  githubUrl?: string;
}

export type LoadStoredFile = (bucket: string, key: string) => Promise<Buffer>;

/**
 * The legacy extracted learner response (what gets stored) → what v3 reads.
 * Text answers become light Markdown; files are loaded from storage on demand.
 */
export function toSubmissionSource(
  questionType: QuestionType,
  learnerResponse: unknown,
  loadStoredFile: LoadStoredFile,
): SubmissionSource {
  if (typeof learnerResponse === "string") {
    if (questionType === QuestionType.TEXT) {
      return { text: plain(learnerResponse) };
    }
    return { urls: [learnerResponse] };
  }
  if (!Array.isArray(learnerResponse)) return {};

  const files: SubmissionFile[] = [];
  const urls: string[] = [];
  for (const raw of learnerResponse as LegacyFileReference[]) {
    const bucket = raw.bucket ?? raw.imageBucket;
    const key = raw.key ?? raw.imageKey;
    if (bucket && key) {
      files.push({
        name: raw.filename || key.split("/").pop() || "file",
        mimeType: raw.mimeType ?? raw.fileType,
        load: () => loadStoredFile(bucket, key),
      });
    } else if (raw.githubUrl) {
      urls.push(raw.githubUrl);
    }
  }
  return { files, urls };
}
