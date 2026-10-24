import type { ResponseType } from "@/config/types";

/**
 * Recording and presentation answers are no longer graded. A question with
 * one of these response types shows a notice instead of a recorder, never
 * blocks submitting, and gets no entry in the submit request (the API refuses
 * one with `UNSUPPORTED_RESPONSE_TYPE`).
 */
export const UNSUPPORTED_RESPONSE_TYPES: readonly ResponseType[] = [
  "PRESENTATION",
  "VIDEO",
  "AUDIO",
  "LIVE_RECORDING",
];

export const UNSUPPORTED_QUESTION_NOTICE =
  "This question type is no longer supported and is not graded.";

export function isUnsupportedResponseType(
  responseType: ResponseType | string | null | undefined,
): boolean {
  return (
    typeof responseType === "string" &&
    (UNSUPPORTED_RESPONSE_TYPES as readonly string[]).includes(responseType)
  );
}

export function isUnsupportedQuestion(question: {
  responseType?: ResponseType | string | null;
}): boolean {
  return isUnsupportedResponseType(question.responseType);
}
