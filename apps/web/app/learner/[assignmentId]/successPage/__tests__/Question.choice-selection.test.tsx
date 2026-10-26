/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import type {
  CompletedAttemptChoice,
  CompletedAttemptQuestion,
  Feedback,
} from "@/config/types";

import Question from "../Question";

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));
jest.mock("@/stores/learner", () => ({
  useAssignmentDetails: (selector: (state: unknown) => unknown) =>
    selector({ assignmentDetails: { questionControls: {} } }),
}));
jest.mock("@/components/MarkdownViewer", () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
jest.mock("@/components/CollapsibleFeedback", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/PdfFeedbackViewer", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/FileExplorer/FilePreview", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../PdfAnnotationModal", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../../../(components)/Question/ShowHideRubric", () => ({
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
jest.mock("@/lib/shared", () => ({
  fetchFileContentSafe: jest.fn(),
  downloadFile: jest.fn(),
  getFileExtension: () => "txt",
}));

type ChoiceType = "SINGLE_CORRECT" | "MULTIPLE_CORRECT";

// The completed-attempt endpoint returns choices in the order the learner saw
// them and the stored answer as the chosen choice text.
const choiceQuestion = ({
  type = "SINGLE_CORRECT",
  choices,
  correct,
  storedResponse,
  revealCorrect = true,
  points = 1,
  feedback = [],
}: {
  type?: ChoiceType;
  choices: string[];
  correct: string[];
  storedResponse?: unknown;
  revealCorrect?: boolean;
  points?: number | null;
  feedback?: Feedback[] | null;
}): CompletedAttemptQuestion => ({
  id: 26299,
  question: "Pick one",
  totalPoints: 1,
  type,
  responseType: null,
  scoring: null,
  choices: choices.map(
    (choice, index): CompletedAttemptChoice =>
      revealCorrect
        ? {
            id: index,
            choice,
            isCorrect: correct.includes(choice),
            feedback: correct.includes(choice) ? "Right" : "Wrong",
          }
        : { id: index, choice },
  ),
  response:
    storedResponse === undefined
      ? null
      : { learnerResponse: storedResponse, points, feedback },
});

const renderQuestion = (
  question: CompletedAttemptQuestion,
  overrides: Partial<{
    showSubmissionFeedback: boolean;
    showQuestionScore: boolean;
  }> = {},
) =>
  render(
    <Question
      question={question}
      number={7}
      language="en"
      showSubmissionFeedback={overrides.showSubmissionFeedback ?? true}
      showQuestionScore={overrides.showQuestionScore ?? true}
      correctAnswerVisibility="ALWAYS"
    />,
  );

const selectedChoices = (question: CompletedAttemptQuestion): string[] => {
  const { container } = renderQuestion(question);
  return Array.from(container.querySelectorAll("li"))
    .filter((li) => li.querySelector<HTMLInputElement>("input")?.checked)
    .map((li) => li.querySelector(".font-medium")?.textContent?.trim() ?? "");
};

describe("results page — which choices show as selected", () => {
  it("selects only the answered choice when choice texts are digits", () => {
    expect(
      selectedChoices(
        choiceQuestion({
          choices: ["2", "1", "3", "1110"],
          correct: ["2"],
          storedResponse: JSON.stringify(["2"]),
        }),
      ),
    ).toEqual(["2"]);
  });

  it("does not select the choice sitting at the answer's position in a shuffled order", () => {
    expect(
      selectedChoices(
        choiceQuestion({
          choices: ["1", "2", "1110", "3"],
          correct: ["2"],
          storedResponse: JSON.stringify(["2"]),
        }),
      ),
    ).toEqual(["2"]);
  });

  it("selects exactly the answered choices of a multi-select with digit texts", () => {
    expect(
      selectedChoices(
        choiceQuestion({
          type: "MULTIPLE_CORRECT",
          choices: ["3", "0", "1", "2"],
          correct: ["1", "3"],
          storedResponse: JSON.stringify(["1", "3"]),
        }),
      ),
    ).toEqual(["3", "1"]);
  });

  it("matches an already-parsed answer by text, not by position", () => {
    expect(
      selectedChoices(
        choiceQuestion({
          choices: ["0", "1", "2"],
          correct: ["2"],
          storedResponse: ["1"],
        }),
      ),
    ).toEqual(["1"]);
  });

  it("selects the translated choice text the learner answered with", () => {
    expect(
      selectedChoices(
        choiceQuestion({
          choices: ["Tal vez", "Sí", "No"],
          correct: ["Sí"],
          storedResponse: JSON.stringify(["No"]),
        }),
      ),
    ).toEqual(["No"]);
  });

  it("selects nothing when the answer matches no choice text", () => {
    expect(
      selectedChoices(
        choiceQuestion({
          choices: ["Paris", "Rome", "Madrid"],
          correct: ["Paris"],
          storedResponse: JSON.stringify(["1"]),
        }),
      ),
    ).toEqual([]);
  });

  it("selects a digit choice stored as a bare value rather than an array", () => {
    expect(
      selectedChoices(
        choiceQuestion({
          choices: ["3", "2", "1"],
          correct: ["2"],
          storedResponse: "2",
        }),
      ),
    ).toEqual(["2"]);
  });
});

describe("results page — what the server chose to show", () => {
  it("marks right and wrong choices only when the server sent isCorrect", () => {
    const { container } = renderQuestion(
      choiceQuestion({
        choices: ["Paris", "Rome"],
        correct: ["Paris"],
        storedResponse: JSON.stringify(["Rome"]),
        points: 0,
      }),
    );

    expect(container.querySelectorAll("li.bg-green-50")).toHaveLength(1);
    expect(container.querySelectorAll("li.bg-red-50")).toHaveLength(1);
    expect(screen.getByText("Wrong")).toBeTruthy();
  });

  it("marks nothing as correct when the server withheld the answer key", () => {
    const { container } = renderQuestion(
      choiceQuestion({
        choices: ["Paris", "Rome"],
        correct: ["Paris"],
        storedResponse: JSON.stringify(["Rome"]),
        revealCorrect: false,
        points: 0,
      }),
    );

    expect(container.querySelectorAll("li.bg-green-50")).toHaveLength(0);
    expect(container.querySelectorAll("li.bg-red-50")).toHaveLength(0);
    expect(screen.queryByText("Wrong")).toBeNull();
  });

  it("shows the score when points are present", () => {
    renderQuestion(
      choiceQuestion({
        choices: ["Paris", "Rome"],
        correct: ["Paris"],
        storedResponse: JSON.stringify(["Paris"]),
      }),
    );

    expect(screen.getByText("1/1")).toBeTruthy();
  });

  it("says the points are hidden when the server sent null points", () => {
    renderQuestion(
      choiceQuestion({
        choices: ["Paris", "Rome"],
        correct: ["Paris"],
        storedResponse: JSON.stringify(["Paris"]),
        points: null,
      }),
    );

    expect(screen.getByText("Points hidden")).toBeTruthy();
    expect(screen.queryByText("1/1")).toBeNull();
  });

  it("says the feedback is hidden when the server sent null feedback", () => {
    renderQuestion(
      choiceQuestion({
        choices: ["Paris", "Rome"],
        correct: ["Paris"],
        storedResponse: JSON.stringify(["Paris"]),
        feedback: null,
      }),
    );

    expect(
      screen.getByText(/Feedback has been hidden by the instructor/),
    ).toBeTruthy();
  });

  it("shows a notice instead of an answer for an unsupported recording question", () => {
    renderQuestion({
      id: 9,
      question: "Record a pitch",
      totalPoints: 5,
      type: "UPLOAD",
      responseType: "LIVE_RECORDING",
      choices: null,
      scoring: null,
      response: null,
    });

    expect(
      screen.getByText(
        "This question type is no longer supported and is not graded.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Not graded")).toBeTruthy();
  });
});
