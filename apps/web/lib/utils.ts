import { LearnerResponseType } from "@/app/learner/[assignmentId]/successPage/Question";
import type { QuestionStore } from "@/config/types";
import { useAppConfig } from "@/stores/appConfig";
import { type ClassValue, clsx } from "clsx";
import { useCallback } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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

type DebugArgs = string | number | boolean | object;

export const useDebugLog = () => {
  const debugMode = process.env.NODE_ENV === "development";

  const debugLog = useCallback(
    (...args: DebugArgs[]) => {
      if (debugMode) {
        const formattedArgs = args.map((arg) => {
          if (typeof arg === "object") {
            return JSON.stringify(arg, null, 2);
          }
          return String(arg);
        });
        console.debug(
          `%c [${new Date().toISOString()}]:`,
          "color: #888; font-style: italic;",
          ...formattedArgs,
        );
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
 * @param attempts - The number of attempts made to parse the response (default is 0).
 * @returns The parsed response as a JSON object or the original response string if parsing fails.
 */
export function parseLearnerResponse(response: string, attempts = 0) {
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

const validateURL = (str: string) => {
  const pattern = new RegExp(
    "^(https?:\\/\\/)?" +
      "((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|" +
      "((\\d{1,3}\\.){3}\\d{1,3}))" +
      "(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*" +
      "(\\?[;&a-z\\d%_.~+=-]*)?" +
      "(\\#[-a-z\\d_]*)?$",
    "i",
  );
  return pattern.test(str);
};

export const editedQuestionsOnly = (questions: QuestionStore[]) =>
  questions.filter(
    (q) =>
      q.learnerTextResponse ||
      (q.learnerUrlResponse && validateURL(q.learnerUrlResponse)) ||
      (q.learnerChoices?.length ?? 0) > 0 ||
      q.learnerAnswerChoice !== undefined ||
      q.learnerFileResponse !== undefined ||
      q.presentationResponse !== undefined,
  );

export const getSubmitButtonStatus = (
  questions: QuestionStore[],
  submitting: boolean,
) => {
  if (submitting) {
    return { disabled: true, reason: "Submitting assignment..." };
  }

  const questionsWithResponses = questions.filter(
    (q) =>
      q.learnerTextResponse ||
      q.learnerUrlResponse ||
      (q.learnerChoices?.length ?? 0) > 0 ||
      q.learnerAnswerChoice !== undefined ||
      q.learnerFileResponse !== undefined ||
      q.presentationResponse !== undefined,
  );

  if (questionsWithResponses.length === 0) {
    return { disabled: true, reason: "No questions have been answered" };
  }

  const questionsWithInvalidUrls = questionsWithResponses.filter(
    (q) => q.learnerUrlResponse && !validateURL(q.learnerUrlResponse),
  );

  if (questionsWithInvalidUrls.length > 0) {
    return {
      disabled: true,
      reason: `${questionsWithInvalidUrls.length} question${questionsWithInvalidUrls.length > 1 ? "s have" : " has"} invalid URL${questionsWithInvalidUrls.length > 1 ? "s" : ""}`,
    };
  }

  const validEditedQuestions = editedQuestionsOnly(questions);
  if (validEditedQuestions.length === 0) {
    return { disabled: true, reason: "No valid responses to submit" };
  }

  return { disabled: false, reason: null };
};

export const generateTempQuestionId = (): number => {
  return Math.floor(Math.random() * 2e9);
};

export const omit = (obj: object, keys: string[]): object => {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !keys.includes(k)),
  );
};
