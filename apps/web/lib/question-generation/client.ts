import {
  AssignmentTypeEnum,
  QuestionGenerationPayload,
  QuestionAuthorStore,
  ResponseType,
} from "@/config/types";
import { getJobStatus, uploadFiles } from "@/lib/talkToBackend";

export type QuestionGenerationStatus = {
  status: string;
  progress: string;
  progressPercentage?: string;
  questions?: QuestionAuthorStore[];
};

type SupportedQuestionType =
  | "SINGLE_CORRECT"
  | "MULTIPLE_CORRECT"
  | "TEXT"
  | "TRUE_FALSE"
  | "URL"
  | "UPLOAD"
  | "LINK_FILE";

type BuildPayloadFromObjectivesInput = {
  assignmentId: number;
  learningObjectives: string;
  questionTypes?: string[];
  count?: number;
  assignmentType?: AssignmentTypeEnum;
};

type CoerceCreateQuestionTypeInput = {
  questionType: string;
  prompt?: string;
};

type QuestionGenerationCountKey = Exclude<
  keyof QuestionGenerationPayload["questionsToGenerate"],
  "responseTypes"
>;

const DEFAULT_CHAT_COUNT = 5;
const DEFAULT_CHAT_QUESTION_TYPES: SupportedQuestionType[] = [
  "SINGLE_CORRECT",
  "MULTIPLE_CORRECT",
  "TEXT",
  "TRUE_FALSE",
];

const QUESTION_TYPE_ALIASES: Record<string, SupportedQuestionType> = {
  MULTIPLE_CHOICE: "SINGLE_CORRECT",
  MULTIPLE_SELECT: "MULTIPLE_CORRECT",
  TEXT_RESPONSE: "TEXT",
  TRUEFALSE: "TRUE_FALSE",
  LINK_OR_FILE: "LINK_FILE",
};

const QUESTION_TYPE_TO_PAYLOAD_KEY: Record<
  SupportedQuestionType,
  QuestionGenerationCountKey
> = {
  SINGLE_CORRECT: "multipleChoice",
  MULTIPLE_CORRECT: "multipleSelect",
  TEXT: "textResponse",
  TRUE_FALSE: "trueFalse",
  URL: "url",
  UPLOAD: "upload",
  LINK_FILE: "linkFile",
};

const MCQ_INTENT_PATTERN = /\bmcq\b|\bmultiple[\s-]*choice\b/i;
const MULTI_SELECT_INTENT_PATTERN =
  /\bselect\s+all(?:\s+that\s+apply)?\b|\bmultiple[\s-]*correct\b|\bmulti(?:ple)?[\s-]*select\b|\bmore\s+than\s+one\s+correct\b|\bmore\s+than\s+one\s+answer\b/i;

function normalizeQuestionType(rawType: string): SupportedQuestionType | null {
  if (typeof rawType !== "string") {
    return null;
  }

  const normalized = rawType.trim().toUpperCase();
  const canonical =
    QUESTION_TYPE_ALIASES[normalized] || (normalized as SupportedQuestionType);

  return Object.prototype.hasOwnProperty.call(
    QUESTION_TYPE_TO_PAYLOAD_KEY,
    canonical,
  )
    ? canonical
    : null;
}

/**
 * Coerce createQuestion type based on prompt intent.
 * If the prompt asks for MCQ and does not imply multi-select, force single-correct.
 */
export function coerceCreateQuestionTypeForPrompt({
  questionType,
  prompt,
}: CoerceCreateQuestionTypeInput): SupportedQuestionType | null {
  const normalizedQuestionType = normalizeQuestionType(questionType);
  if (!normalizedQuestionType) {
    return null;
  }

  if (typeof prompt !== "string" || !prompt.trim()) {
    return normalizedQuestionType;
  }

  const asksForMcq = MCQ_INTENT_PATTERN.test(prompt);
  const asksForMultipleCorrect = MULTI_SELECT_INTENT_PATTERN.test(prompt);
  if (asksForMcq && !asksForMultipleCorrect) {
    return "SINGLE_CORRECT";
  }

  return normalizedQuestionType;
}

function normalizeQuestionTypeList(
  questionTypes?: string[],
): SupportedQuestionType[] {
  if (!Array.isArray(questionTypes) || questionTypes.length === 0) {
    return DEFAULT_CHAT_QUESTION_TYPES;
  }

  const deduped = new Set<SupportedQuestionType>();
  for (const rawType of questionTypes) {
    const normalized = normalizeQuestionType(rawType);
    if (normalized) {
      deduped.add(normalized);
    }
  }

  return deduped.size > 0 ? Array.from(deduped) : DEFAULT_CHAT_QUESTION_TYPES;
}

function getSafeQuestionCount(count?: number): number {
  if (!Number.isFinite(count) || !count || count <= 0) {
    return DEFAULT_CHAT_COUNT;
  }
  return Math.max(1, Math.floor(count));
}

function getDefaultResponseTypes(): QuestionGenerationPayload["questionsToGenerate"]["responseTypes"] {
  return {
    TEXT: "OTHER" as ResponseType,
    URL: "OTHER" as ResponseType,
    UPLOAD: "OTHER" as ResponseType,
    LINK_FILE: "OTHER" as ResponseType,
  };
}

/**
 * Build canonical question-generation payload from chatbot objective params.
 */
export function buildQuestionGenerationPayloadFromObjectives({
  assignmentId,
  learningObjectives,
  questionTypes,
  count,
  assignmentType = AssignmentTypeEnum.PRACTICE,
}: BuildPayloadFromObjectivesInput): QuestionGenerationPayload {
  const safeCount = getSafeQuestionCount(count);
  const normalizedTypes = normalizeQuestionTypeList(questionTypes);

  const questionsToGenerate: QuestionGenerationPayload["questionsToGenerate"] =
    {
      multipleChoice: 0,
      multipleSelect: 0,
      textResponse: 0,
      trueFalse: 0,
      url: 0,
      upload: 0,
      linkFile: 0,
      responseTypes: getDefaultResponseTypes(),
    };

  for (let index = 0; index < safeCount; index++) {
    const type = normalizedTypes[index % normalizedTypes.length];
    const key = QUESTION_TYPE_TO_PAYLOAD_KEY[type];
    questionsToGenerate[key] += 1;
  }

  return {
    assignmentId,
    assignmentType,
    questionsToGenerate,
    fileContents: [],
    learningObjectives,
  };
}

type PollQuestionGenerationJobOptions = {
  jobId: number;
  intervalMs?: number;
  onUpdate: (status: QuestionGenerationStatus) => void;
  onCompleted: (status: QuestionGenerationStatus) => void;
  onFailed: (status: QuestionGenerationStatus) => void;
  onError: (error: unknown) => void;
};

/**
 * Start a backend question-generation job.
 */
export async function startQuestionGenerationJob(
  payload: QuestionGenerationPayload,
): Promise<number> {
  const response = await uploadFiles(payload);

  if (!response.success || !response.jobId) {
    throw new Error("Failed to upload files");
  }

  return response.jobId;
}

/**
 * Poll backend job status until completion or failure.
 * Returns a cleanup function to stop polling.
 */
export function pollQuestionGenerationJob({
  jobId,
  intervalMs = 2500,
  onUpdate,
  onCompleted,
  onFailed,
  onError,
}: PollQuestionGenerationJobOptions): () => void {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };

  intervalId = setInterval(async () => {
    try {
      const statusData = await getJobStatus(jobId);

      if (!statusData) {
        throw new Error("Failed to fetch job status");
      }

      onUpdate(statusData);

      if (statusData.status === "Completed") {
        stop();
        onCompleted(statusData);
      } else if (statusData.status === "Failed") {
        stop();
        onFailed(statusData);
      }
    } catch (error: unknown) {
      stop();
      onError(error);
    }
  }, intervalMs);

  return stop;
}
