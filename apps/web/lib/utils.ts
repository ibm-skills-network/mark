import type { QuestionStore } from "@/config/types";
import { useAppConfig } from "@/stores/appConfig";

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
  const localDataExists = localData?.updatedAt;
  const localDataIsNewer =
    new Date(localData.updatedAt) > new Date(backendData.updatedAt);
  const oneWeekAgo = new Date(); // this is configurable based on requirements. I went with a week because its not too long and not too short. 
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const localDataIsOlderThanAWeek = new Date(localData.updatedAt) < oneWeekAgo;

  if (localDataExists && localDataIsNewer && !localDataIsOlderThanAWeek) {
    return localData; // ensure that the cached data doesnt become outdated and use the backend data instead to avoid issues when mark gets an update
  }
  return backendData;
}

type DebugArgs = string | number | boolean | object;

export const useDebugLog = () => {
  const debugMode = useAppConfig((state) => state.DEBUG_MODE);
  const useDebugLog = (...args: DebugArgs[]) => {
    if (debugMode) {
      console.log("DEBUG LOG:", ...args);
    }
  };

  return useDebugLog;
};

export const editedQuestionsOnly = (questions: QuestionStore[]) =>
  questions.filter(
    (q) =>
      q.learnerTextResponse ||
      q.learnerUrlResponse ||
      q.learnerChoices?.length > 0 ||
      q.learnerAnswerChoice !== undefined,
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
