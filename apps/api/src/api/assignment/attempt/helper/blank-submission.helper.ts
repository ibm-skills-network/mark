import type { QuestionResponse } from "../dto/assignment-attempt/create.update.assignment.attempt.request.dto";

/**
 * What an emptied rich-text editor serialises to. Paragraphs may carry
 * attributes (alignment, `dir`) that survive deleting their text. Kept in step
 * with `isRichTextEmpty` in `packages/rich-text`, which the web app uses.
 */
const EMPTY_RICH_TEXT =
  /^(?:<p(?:\s[^>]*)?>(?:\s|&nbsp;|&#160;|&#xa0;|<br\s*\/?>)*<\/p>|<br\s*\/?>|&nbsp;|&#160;|&#xa0;|\s)*$/i;

/** Whether a text or rich-text field holds more than an empty editor's markup. */
export const hasTextContent = (value: unknown): boolean =>
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
    hasTextContent(response.learnerTextResponse) ||
    hasTextContent(response.learnerUrlResponse) ||
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
