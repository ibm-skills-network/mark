/**
 * @jest-environment jsdom
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuestionDisplayType, type QuestionStore } from "@/config/types";
import {
  useAssignmentDetails,
  useLearnerOverviewStore,
  useLearnerStore,
} from "@/stores/learner";
import QuestionContainer from "../QuestionContainer";

jest.mock("../RenderQuestion", () => ({
  __esModule: true,
  default: () => <div data-testid="render-question" />,
}));

jest.mock("../ShowHideRubric", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("@/components/MarkdownViewer", () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

jest.mock("@/lib/talkToBackend", () => ({
  translateQuestion: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/stores/learner", () => ({
  useAssignmentDetails: jest.fn(),
  useLearnerOverviewStore: jest.fn(),
  useLearnerStore: jest.fn(),
}));

const learnerState = {
  activeQuestionNumber: 1,
  setActiveQuestionNumber: jest.fn(),
  role: "learner",
  setQuestionStatus: jest.fn(),
  getQuestionStatusById: () => "unedited",
  setSelectedLanguage: jest.fn(),
  getTranslationOn: () => false,
  setTranslationOn: jest.fn(),
  setTranslatedQuestion: jest.fn(),
  setTranslatedChoices: jest.fn(),
  userPreferedLanguage: "en",
  setUserPreferedLanguage: jest.fn(),
  globalLanguage: "English",
  setGlobalLanguage: jest.fn(),
};

const question = {
  id: 11,
  type: "TEXT",
  question: "<p>Explain your answer</p>",
  totalPoints: 5,
  scoring: { rubrics: [], showRubricsToLearner: false, showPoints: false },
  selectedLanguage: "English",
  choices: [],
} as unknown as QuestionStore;

function renderQuestion(
  questionDisplay: QuestionDisplayType,
  questionNumber: number,
  lastQuestionNumber: number,
) {
  return render(
    <QuestionContainer
      question={question}
      questionNumber={questionNumber}
      questionId={question.id}
      questionDisplay={questionDisplay}
      lastQuestionNumber={lastQuestionNumber}
    />,
  );
}

describe("QuestionContainer submit affordance", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (useLearnerStore as unknown as jest.Mock).mockImplementation(
      (selector: (state: typeof learnerState) => unknown) =>
        selector(learnerState),
    );
    (useAssignmentDetails as unknown as jest.Mock).mockImplementation(
      (selector: (state: unknown) => unknown) =>
        selector({ assignmentDetails: { questionControls: null } }),
    );
    (useLearnerOverviewStore as unknown as jest.Mock).mockImplementation(
      (selector: (state: unknown) => unknown) => selector({ assignmentId: 1 }),
    );
  });

  it("shows the in-page submit button on the last question of a one-per-page assignment", () => {
    renderQuestion(QuestionDisplayType.ONE_PER_PAGE, 3, 3);

    expect(
      screen.getByRole("button", { name: /submit assignment/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /previous question/i }),
    ).toBeInTheDocument();
  });

  it("shows an in-page submit button on the last question of an all-per-page assignment", () => {
    renderQuestion(QuestionDisplayType.ALL_PER_PAGE, 3, 3);

    expect(
      screen.getByRole("button", { name: /submit assignment/i }),
    ).toBeInTheDocument();
  });

  it("does not repeat the submit button on every all-per-page question", () => {
    renderQuestion(QuestionDisplayType.ALL_PER_PAGE, 1, 3);

    expect(
      screen.queryByRole("button", { name: /submit assignment/i }),
    ).toBeNull();
  });

  it("does not add per-question navigation to an all-per-page assignment", () => {
    renderQuestion(QuestionDisplayType.ALL_PER_PAGE, 3, 3);

    expect(
      screen.queryByRole("button", { name: /previous question/i }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /next question/i })).toBeNull();
  });

  it("requests submission through the same event the header listens for", () => {
    const onSubmit = jest.fn();
    window.addEventListener("triggerAssignmentSubmission", onSubmit);

    renderQuestion(QuestionDisplayType.ALL_PER_PAGE, 2, 2);
    fireEvent.click(screen.getByRole("button", { name: /submit assignment/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    window.removeEventListener("triggerAssignmentSubmission", onSubmit);
  });
});
