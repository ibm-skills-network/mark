/**
 * @jest-environment jsdom
 */

import { render } from "@testing-library/react";
import type { ReactNode } from "react";

import { QuestionStore } from "@/config/types";

import Question from "../Question";

jest.mock("@/lib/talkToBackend", () => ({
  AuthorizeGithubBackend: jest.fn(),
  getStoredGithubToken: jest.fn(),
}));
jest.mock("@octokit/rest", () => ({ Octokit: class {} }));
jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));
jest.mock("@/stores/learner", () => ({
  useAssignmentDetails: (selector: (state: unknown) => unknown) =>
    selector({ assignmentDetails: { questionControls: {} } }),
  useLearnerOverviewStore: (selector: (state: unknown) => unknown) =>
    selector({ assignmentId: 3601 }),
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
  learnerChoices,
}: {
  type?: ChoiceType;
  choices: string[];
  correct: string[];
  storedResponse?: string;
  learnerChoices?: string[];
}): QuestionStore =>
  ({
    id: 26299,
    question: "Pick one",
    totalPoints: 1,
    type,
    choices: choices.map((choice) => ({
      choice,
      isCorrect: correct.includes(choice),
      points: correct.includes(choice) ? 1 : 0,
      feedback: "",
    })),
    learnerChoices,
    questionResponses:
      storedResponse === undefined
        ? []
        : [{ id: 1, points: 1, feedback: [], learnerResponse: storedResponse }],
    // A fixture, not a real store entry: only the fields the choice list reads
    // are populated.
  }) as unknown as QuestionStore;

const selectedChoices = (question: QuestionStore): string[] => {
  const { container } = render(
    <Question
      question={question}
      number={7}
      language="en"
      showSubmissionFeedback
      showCorrectAnswer
      correctAnswerVisibility="ALWAYS"
    />,
  );
  return Array.from(container.querySelectorAll("li"))
    .filter((li) => li.querySelector<HTMLInputElement>("input")?.checked)
    .map((li) => li.textContent?.trim() ?? "");
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

  it("matches the server's learnerChoices by text, not by position", () => {
    expect(
      selectedChoices(
        choiceQuestion({
          choices: ["0", "1", "2"],
          correct: ["2"],
          learnerChoices: ["1"],
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
