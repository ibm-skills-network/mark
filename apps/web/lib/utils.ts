import { LearnerResponseType } from "@/app/learner/[assignmentId]/successPage/Question";
import type { QuestionStore } from "@/config/types";
import { useAppConfig } from "@/stores/appConfig";
import { useCallback } from "react";

export function absoluteUrl(path: string) {
  const base = getBaseUrl();
  return `${base}${path}`;
}

const getBaseUrl = () => {
  if (typeof window !== "undefined") return ""; // browser should use relative url
  if (process.env.NODE_ENV === "production")
    //if next server wants to get the base url
    return "http://mark-api-gateway"; // SSR should use production url
  return `http://localhost:${process.env.PORT ?? 3000}`; // dev SSR should use localhost
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
  // If either updatedAt is missing, fallback to backend data.
  if (!localData?.updatedAt || !backendData.updatedAt) {
    return backendData;
  }

  const localDate = new Date(localData.updatedAt);
  const backendDate = new Date(backendData.updatedAt);

  // Define a threshold for stale data (e.g. one week ago).
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  // If local data is newer than backend and not older than a week, use local.
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
        console.debug("[DEBUG LOG]:", ...args);
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
        break; // if the response is not a string or a valid JSON, then break out of the loop
      }
      attempts++;
    }

    return parsedResponse;
  } catch (e) {
    console.error(
      `Failed to parse learnerResponse after ${attempts} attempts:`,
      e,
    );
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

export const editedQuestionsOnly = (questions: QuestionStore[]) =>
  questions.filter(
    (q) =>
      q.learnerTextResponse ||
      q.learnerUrlResponse ||
      (q.learnerChoices?.length ?? 0) > 0 ||
      q.learnerAnswerChoice !== undefined ||
      q.learnerFileResponse !== undefined ||
      q.presentationResponse !== undefined,
  );

export const generateTempQuestionId = (): number => {
  return Math.floor(Math.random() * 2e9); // Generates a number between 0 and 2,000,000,000
};
// export function debounce<T extends (...args: unknown[]) => void>(
//   func: T,
//   delay: number
// ): (...args: Parameters<T>) => void {
//   let timer: ReturnType<typeof setTimeout>;
//   return (...args: Parameters<T>): void => {
//     clearTimeout(timer);
//     timer = setTimeout(() => {
//       func.apply(this, args);
//     }, delay);
//   };
// }
