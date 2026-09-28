import { hasRichTextContent } from "rich-text";

import type { QuestionResponse } from "../dto/assignment-attempt/create.update.assignment.attempt.request.dto";

const hasRichText = (value: unknown): boolean =>
  typeof value === "string" && hasRichTextContent(value);

const hasPlainText = (value: unknown): boolean =>
  typeof value === "string" && value.trim().length > 0;

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
    hasRichText(response.learnerTextResponse) ||
    hasPlainText(response.learnerUrlResponse) ||
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
