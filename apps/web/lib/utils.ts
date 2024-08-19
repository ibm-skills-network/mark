import type { QuestionStore } from "@/config/types";

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

export function getWordCount(str: string | undefined) {
  return str?.split(/\s+/).filter(Boolean).length ?? 0;
}

export interface DataWithUpdatedAt {
  updatedAt: Date | number;
}

export function mergeData<T extends DataWithUpdatedAt>(
  localData: T,
  backendData: Partial<T>,
): T | Partial<T> {
  console.log("localData", localData);
  console.log("backendData", backendData);
  const localDataExists = localData?.updatedAt;
  const localDataIsNewer =
    new Date(localData.updatedAt) > new Date(backendData.updatedAt);
  if (localDataExists && localDataIsNewer) {
    return localData;
  }
  return backendData;
}

export const editedQuestionsOnly = (questions: QuestionStore[]) =>
  questions.filter(
    (q) =>
      q.learnerTextResponse ||
      q.learnerUrlResponse ||
      q.learnerChoices?.length > 0,
  );
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
