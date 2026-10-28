import { QuestionType } from "@prisma/client";
import type { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { parseJsonField } from "src/api/attempt/common/utils/grading-question-source.util";
import type {
  GradingEffort,
  GradingQuestion,
  RubricCriterion,
} from "../v3/grading/contracts";
import { htmlToMarkdown, looksLikeHtml } from "../v3/grading/html-text";
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

export function toGradingQuestion(
  question: QuestionDto,
  effort: GradingEffort,
): GradingQuestion {
  return {
    questionId: question.id,
    questionType: question.type,
    questionText: plain(question.question ?? ""),
    rubric: { criteria: rubricFromLegacy(question) },
    totalPoints: question.totalPoints,
    effort,
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
