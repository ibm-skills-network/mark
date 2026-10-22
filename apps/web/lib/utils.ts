import { LearnerResponseType } from "@/app/learner/[assignmentId]/successPage/Question";
import type { QuestionStore } from "@/config/types";
import { isLearnerUrlSubmittable } from "@/lib/url-response";
import { hasRichTextContent } from "rich-text";
import { type ClassValue, clsx } from "clsx";
import { useCallback } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const INTERACTIVE_TARGET_SELECTOR =
  'button, input, textarea, select, a, [role="button"], [role="combobox"], [role="listbox"], [contenteditable]:not([contenteditable="false"])';

/**
 * Returns true when a click target is (or is nested within) an interactive
 * control, so card/section onClick handlers can skip focus changes for clicks
 * that land on buttons, inputs, links, dropdowns, or editable regions.
 *
 * Read-only regions (contenteditable="false") are intentionally NOT treated as
 * interactive, so clicking them still falls through to the focus handler.
 */
export const isInteractiveTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest(INTERACTIVE_TARGET_SELECTOR) !== null;

export function absoluteUrl(path: string) {
  const base = getBaseUrl();
  return `${base}${path}`;
}
const getBaseUrl = () => {
  if (typeof window !== "undefined") return "";
  if (process.env.NODE_ENV === "production")
    return `${process.env.API_GATEWAY_HOST}`;
  return `http://localhost:${process.env.PORT ?? 3010}`;
};

export const getFeedbackColors = (score: number, totalPoints: number) => {
  switch (score) {
    case totalPoints:
      return "bg-green-100 border-green-500 text-green-700";
    case 0:
      return "bg-red-100 border-red-500 text-red-700";
    default:
      return "bg-yellow-100 border-yellow-500 text-yellow-700";
  }
};

export const getWordCount = (text: string): number => {
  return text?.split(/\s+/).filter(Boolean).length;
};

export interface DataWithUpdatedAt {
  updatedAt: Date | number;
}

export function mergeData<T extends DataWithUpdatedAt>(
  localData: T,
  backendData: Partial<T>,
): T | Partial<T> {
  if (!localData?.updatedAt || !backendData.updatedAt) {
    return backendData;
  }

  const localDate = new Date(localData.updatedAt);
  const backendDate = new Date(backendData.updatedAt);

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  if (localDate > backendDate && localDate > oneWeekAgo) {
    return localData;
  }
  return backendData;
}

/**
 * Reloads the current page. Wrapped so retry actions can be exercised in
 * tests — jsdom's `location.reload` is read-only and cannot be spied on.
 */
export const reloadPage = () => {
  globalThis.location.reload();
};

export const useDebugLog = () => {
  const debugMode = process.env.NODE_ENV === "development";

  const debugLog = useCallback(
    (...args: unknown[]) => {
      if (debugMode) {
        console.debug(...args);
      }
    },
    [debugMode],
  );

  return debugLog;
};

/**
 * Parses a learner's response string into a JSON object if possible.
 * The function attempts to parse the response up to a maximum of 5 times.
 * If the response is not a valid JSON string, it returns the original response.
 *
 * @param response - The learner's response as a string.
 * @returns The parsed response as a JSON object or the original response string if parsing fails.
 */
export function parseLearnerResponse(response: string) {
  try {
    let parsedResponse: LearnerResponseType = response;
    let attempts = 0;
    const maxAttempts = 5;
    while (typeof parsedResponse === "string" && attempts < maxAttempts) {
      if (isValidJSON(parsedResponse)) {
        parsedResponse = JSON.parse(parsedResponse) as LearnerResponseType;
      } else {
        break;
      }
      attempts++;
    }

    return parsedResponse;
  } catch (e) {
    return response;
  }
}
function isValidJSON(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

const hasPresentationResponse = (
  response?: QuestionStore["presentationResponse"],
): boolean => {
  if (!response) return false;
  const transcript = response.transcript?.trim() ?? "";
  if (transcript.length > 0) {
    return true;
  }
  return (response.slidesData?.length ?? 0) > 0;
};

export const hasLearnerResponse = (question: QuestionStore): boolean => {
  const hasText = hasRichTextContent(question.learnerTextResponse);
  const hasUrl = Boolean(question.learnerUrlResponse?.trim());
  const hasChoices = (question.learnerChoices?.length ?? 0) > 0;
  const hasAnswerChoice =
    question.learnerAnswerChoice !== null &&
    question.learnerAnswerChoice !== undefined;
  const hasFiles = (question.learnerFileResponse?.length ?? 0) > 0;
  const presentationResponse =
    question.presentationResponse ?? question.learnerPresentationResponse;
  const hasPresentation = hasPresentationResponse(presentationResponse);

  return (
    hasText ||
    hasUrl ||
    hasChoices ||
    hasAnswerChoice ||
    hasFiles ||
    hasPresentation
  );
};

export const editedQuestionsOnly = (questions: QuestionStore[]) =>
  questions.filter((q) => {
    const hasText = hasRichTextContent(q.learnerTextResponse);
    // Presence, not validity: a link the learner typed is an answer even when
    // it does not parse. Treating it as unanswered used to trip the
    // "you have unanswered questions" modal on a question they had filled in.
    const hasUrl = Boolean(q.learnerUrlResponse?.trim());
    const hasChoices = (q.learnerChoices?.length ?? 0) > 0;
    const hasAnswerChoice =
      q.learnerAnswerChoice !== null && q.learnerAnswerChoice !== undefined;
    const hasFiles = (q.learnerFileResponse?.length ?? 0) > 0;
    const presentationResponse =
      q.presentationResponse ?? q.learnerPresentationResponse;
    const hasPresentation = hasPresentationResponse(presentationResponse);

    return (
      hasText ||
      hasUrl ||
      hasChoices ||
      hasAnswerChoice ||
      hasFiles ||
      hasPresentation
    );
  });

/**
 * Discriminated so a blocked submission always carries the reason to show the
 * learner; callers that gate on `disabled` get the message without a fallback.
 */
export type SubmitButtonStatus =
  | { disabled: true; reason: string }
  | { disabled: false; reason: null };

/**
 * Where a question's latest upload stands, while it matters: in flight, or
 * failed with nothing stored. Absent once a file lands (or none was tried).
 */
export type QuestionUploadStatus = "uploading" | "failed";
export type UploadStatusByQuestion = Record<number, QuestionUploadStatus>;

/** Display position (1-based, in the order the learner sees them). */
const positionsOf = (
  questions: QuestionStore[],
  predicate: (question: QuestionStore) => boolean,
): number[] =>
  questions
    .map((question, index) => ({ question, position: index + 1 }))
    .filter(({ question }) => predicate(question))
    .map(({ position }) => position);

export const getSubmitButtonStatus = (
  questions: QuestionStore[],
  submitting: boolean,
  isUploadingFiles?: boolean,
  requireAllQuestions?: boolean,
  optionalQuestionIds?: number[],
  uploadStatusByQuestion?: UploadStatusByQuestion,
): SubmitButtonStatus => {
  if (submitting) {
    return { disabled: true, reason: "Submitting assignment..." };
  }

  const uploadingPositions = positionsOf(
    questions,
    (question) => uploadStatusByQuestion?.[question.id] === "uploading",
  );
  if (uploadingPositions.length > 0) {
    const plural = uploadingPositions.length > 1;
    return {
      disabled: true,
      reason: `Wait for the ${plural ? "files" : "file"} on Question${
        plural ? "s" : ""
      } ${uploadingPositions.join(", ")} to finish uploading.`,
    };
  }
  if (isUploadingFiles) {
    return { disabled: true, reason: "File upload in progress..." };
  }

  const questionsWithResponses = questions.filter(hasLearnerResponse);

  if (questionsWithResponses.length === 0) {
    return { disabled: true, reason: "No questions have been answered" };
  }

  // Only a value that cannot become a web address at all blocks submitting.
  // A pasted trailing space or a missing scheme is normalized by the shared
  // helper on both sides, so those submit and grade normally.
  const invalidUrlPositions = questions
    .map((question, index) => ({ question, position: index + 1 }))
    .filter(
      ({ question }) =>
        Boolean(question.learnerUrlResponse?.trim()) &&
        !isLearnerUrlSubmittable(question.learnerUrlResponse),
    )
    .map(({ position }) => position);

  if (invalidUrlPositions.length > 0) {
    const plural = invalidUrlPositions.length > 1;
    return {
      disabled: true,
      reason: `Check the link on question ${invalidUrlPositions.join(", ")} — ${
        plural ? "they don't" : "it doesn't"
      } look like a web address yet`,
    };
  }

  const validEditedQuestions = editedQuestionsOnly(questions);
  if (validEditedQuestions.length === 0) {
    return { disabled: true, reason: "No valid responses to submit" };
  }

  if (requireAllQuestions) {
    const optionalQuestionSet = new Set(optionalQuestionIds ?? []);
    const requiredQuestions = questions.filter(
      (question) => !optionalQuestionSet.has(question.id),
    );
    const requiredResponses = questionsWithResponses.filter(
      (question) => !optionalQuestionSet.has(question.id),
    );

    // notification for error submitting if required questions are unanswered
    if (requiredResponses.length < requiredQuestions.length) {
      const unansweredCount =
        requiredQuestions.length - requiredResponses.length;
      return {
        disabled: true,
        reason: `All required questions must be answered before submitting (${unansweredCount} unanswered)`,
      };
    }
  }

  return { disabled: false, reason: null };
};

/** Question types whose answer is a file the learner has to upload. */
const FILE_QUESTION_TYPES = new Set(["UPLOAD", "CODE"]);

export const SUBMIT_WARNING_MESSAGES = {
  fileMissing:
    "Your file for Question {question} hasn't been uploaded. Submit anyway?",
  filesMissing:
    "Files for Questions {questions} haven't been uploaded. Submit anyway?",
  uploadFailed:
    "The file upload for Question {question} failed, so nothing will be submitted for it. Submit anyway?",
  flagged: "You have flagged questions. Are you sure you want to submit?",
  unanswered: "You have unanswered questions. Are you sure you want to submit?",
} as const;

/** Every template the submit warning can show, for the translation catalogs. */
export const SUBMIT_WARNING_SOURCE_STRINGS: readonly string[] = Object.values(
  SUBMIT_WARNING_MESSAGES,
);

export interface SubmitWarning {
  /** Translation-catalog key; render with `t(message, params)`. */
  message: string;
  params?: Record<string, string | number>;
}

/**
 * The confirmation to show before submitting, or null to submit straight
 * away. A missing file is named by question number, because "you have
 * unanswered questions" reads as fine to a learner who believes the upload
 * went through. A failed upload is called out even on an optional question:
 * the learner tried to answer it.
 */
export const buildSubmitWarning = (
  questions: QuestionStore[],
  options: {
    optionalQuestionIds?: number[];
    uploadStatusByQuestion?: UploadStatusByQuestion;
  },
): SubmitWarning | null => {
  const optional = new Set(options.optionalQuestionIds ?? []);
  const isAnswered = (question: QuestionStore) =>
    editedQuestionsOnly([question]).length > 0;
  const uploadFailed = (question: QuestionStore) =>
    options.uploadStatusByQuestion?.[question.id] === "failed";

  const failedPositions = positionsOf(
    questions,
    (question) => !isAnswered(question) && uploadFailed(question),
  );
  const missingFilePositions = positionsOf(
    questions,
    (question) =>
      !isAnswered(question) &&
      (uploadFailed(question) ||
        (FILE_QUESTION_TYPES.has(question.type) && !optional.has(question.id))),
  );

  if (missingFilePositions.length === 1) {
    return {
      message:
        failedPositions.length === 1
          ? SUBMIT_WARNING_MESSAGES.uploadFailed
          : SUBMIT_WARNING_MESSAGES.fileMissing,
      params: { question: missingFilePositions[0] },
    };
  }
  if (missingFilePositions.length > 1) {
    return {
      message: SUBMIT_WARNING_MESSAGES.filesMissing,
      params: { questions: missingFilePositions.join(", ") },
    };
  }

  if (questions.some((question) => question.status === "flagged")) {
    return { message: SUBMIT_WARNING_MESSAGES.flagged };
  }

  const unansweredRequired = questions.some(
    (question) => !optional.has(question.id) && !isAnswered(question),
  );
  return unansweredRequired
    ? { message: SUBMIT_WARNING_MESSAGES.unanswered }
    : null;
};

export const generateTempQuestionId = (): number => {
  return Math.floor(Math.random() * 2e9);
};

export const omit = (obj: object, keys: string[]): object => {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !keys.includes(k)),
  );
};
