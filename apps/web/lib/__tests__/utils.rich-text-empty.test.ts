/**
 * @jest-environment jsdom
 */

import type { QuestionStore } from "@/config/types";
import { editedQuestionsOnly, hasLearnerResponse } from "@/lib/utils";

/**
 * These call sites used to compare against the literal `"<p><br></p>"`, which
 * is what Quill serialises an untouched editor to. TipTap serialises the same
 * empty document as `"<p></p>"`, so the old check read a blank answer as
 * answered — wrong progress counts, and a blank response submitted as real
 * work. Both spellings have to stay empty here.
 */
const question = (learnerTextResponse: string): QuestionStore =>
  ({ id: 1, learnerTextResponse }) as unknown as QuestionStore;

describe("hasLearnerResponse", () => {
  it.each([
    ["Quill's empty document", "<p><br></p>"],
    ["TipTap's empty document", "<p></p>"],
    ["a self-closing break", "<p><br/></p>"],
    ["a non-breaking space", "<p>&nbsp;</p>"],
    ["an empty string", ""],
  ])("does not count %s as an answer", (_label, value) => {
    expect(hasLearnerResponse(question(value))).toBe(false);
  });

  it.each([
    ["typed text", "<p>my answer</p>"],
    ["an embedded image", '<p><img src="https://example.com/a.png"></p>'],
  ])("counts %s as an answer", (_label, value) => {
    expect(hasLearnerResponse(question(value))).toBe(true);
  });
});

describe("editedQuestionsOnly", () => {
  it("drops questions whose only content is an empty editor document", () => {
    const edited = editedQuestionsOnly([
      question("<p><br></p>"),
      question("<p></p>"),
      question("<p>real answer</p>"),
    ]);

    expect(edited).toHaveLength(1);
    expect(edited[0]?.learnerTextResponse).toBe("<p>real answer</p>");
  });
});
