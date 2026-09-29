import type { QuestionResponse } from "../dto/assignment-attempt/create.update.assignment.attempt.request.dto";

/** What an untouched rich-text editor serialises to. */
const EMPTY_RICH_TEXT = /^(?:<p>(?:<br\s*\/?>)?<\/p>|<br\s*\/?>|&nbsp;|\s)*$/i;

const hasText = (value: unknown): boolean =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  !EMPTY_RICH_TEXT.test(value.trim());

/**
 * Whether the learner actually put something in this response. Choice, file and
 * true/false answers count as answered even when the text body is empty.
 */
export const isAnsweredResponse = (
  response: Partial<QuestionResponse> | null | undefined,
): boolean => {
  if (!response) {
    return false;
  }

  return (
    hasText(response.learnerTextResponse) ||
    hasText(response.learnerUrlResponse) ||
    (Array.isArray(response.learnerChoices) &&
      response.learnerChoices.length > 0) ||
    typeof response.learnerAnswerChoice === "boolean" ||
    (Array.isArray(response.learnerFileResponse) &&
      response.learnerFileResponse.length > 0) ||
    (response.learnerPresentationResponse !== null &&
      response.learnerPresentationResponse !== undefined)
  );
};

/** How many of the submitted responses carry an actual answer. */
export const countAnsweredResponses = (
  responses: Partial<QuestionResponse>[] | null | undefined,
): number => (responses ?? []).filter((r) => isAnsweredResponse(r)).length;
