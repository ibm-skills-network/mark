import type { QuestionResponse } from "../dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import {
  countAnsweredResponses,
  isAnsweredResponse,
} from "./blank-submission.helper";

const response = (overrides: Partial<QuestionResponse>): QuestionResponse =>
  ({
    id: 1,
    question: "q",
    learnerTextResponse: "",
    learnerUrlResponse: "",
    learnerChoices: [],
    learnerFileResponse: [],
    ...overrides,
  }) as QuestionResponse;

describe("isAnsweredResponse", () => {
  it("treats an empty payload as unanswered", () => {
    expect(isAnsweredResponse(response({}))).toBe(false);
  });

  it("treats an untouched rich-text editor as unanswered", () => {
    // What the learner editor serialises with zero keystrokes.
    expect(
      isAnsweredResponse(response({ learnerTextResponse: "<p><br></p>" })),
    ).toBe(false);
    expect(
      isAnsweredResponse(response({ learnerTextResponse: "<p></p>" })),
    ).toBe(false);
    expect(isAnsweredResponse(response({ learnerTextResponse: "   " }))).toBe(
      false,
    );
  });

  it("counts typed text", () => {
    expect(
      isAnsweredResponse(response({ learnerTextResponse: "<p>hello</p>" })),
    ).toBe(true);
  });

  it("counts a URL, a choice, a true/false answer and a file", () => {
    expect(
      isAnsweredResponse(
        response({ learnerUrlResponse: "https://example.com" }),
      ),
    ).toBe(true);
    expect(isAnsweredResponse(response({ learnerChoices: ["0"] }))).toBe(true);
    expect(isAnsweredResponse(response({ learnerAnswerChoice: false }))).toBe(
      true,
    );
    expect(
      isAnsweredResponse(
        response({
          learnerFileResponse: [
            { filename: "a.txt", mimeType: "text/plain" },
          ] as QuestionResponse["learnerFileResponse"],
        }),
      ),
    ).toBe(true);
  });

  it("tolerates a missing response", () => {
    expect(isAnsweredResponse(undefined)).toBe(false);
    expect(isAnsweredResponse(null)).toBe(false);
  });
});

describe("countAnsweredResponses", () => {
  it("counts nothing for a wholly blank submission", () => {
    expect(
      countAnsweredResponses([
        response({}),
        response({ learnerTextResponse: "<p><br></p>" }),
      ]),
    ).toBe(0);
  });

  it("counts only the responses that carry an answer", () => {
    expect(
      countAnsweredResponses([
        response({}),
        response({ id: 2, learnerTextResponse: "an answer" }),
        response({ id: 3, learnerChoices: ["1"] }),
      ]),
    ).toBe(2);
  });

  it("tolerates a missing list", () => {
    expect(countAnsweredResponses(undefined)).toBe(0);
    expect(countAnsweredResponses([])).toBe(0);
  });
});
