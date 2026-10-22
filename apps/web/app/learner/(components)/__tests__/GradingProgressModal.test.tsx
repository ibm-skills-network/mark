/**
 * @jest-environment jsdom
 */

import React, { createElement } from "react";
import { setStoredUiLanguage } from "@/lib/ui-language";
import { fireEvent, render, screen } from "@testing-library/react";
import GradingProgressModal, {
  type ProgressState,
} from "../GradingProgressModal";

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
}));

jest.mock("@/lib/learner", () => ({
  subscribeToGradingNotification: jest.fn().mockResolvedValue({
    success: true,
    message: "ok",
  }),
}));

jest.mock("@/components/GradeSyncStatus", () => ({
  __esModule: true,
  default: () => null,
}));

// Captures every `error` prop ReportErrorButton receives so tests can assert
// on its referential identity across re-renders. Name must start with
// "mock" — Jest's module-factory hoisting only allows out-of-scope
// references to identifiers matching that prefix.
const mockReportErrorProps: unknown[] = [];

jest.mock("@/components/ReportErrorButton", () => ({
  __esModule: true,
  default: (props: { error: unknown }) => {
    mockReportErrorProps.push(props.error);
    return createElement(
      "button",
      { "data-testid": "report-error" },
      "Report this issue",
    );
  },
}));

const baseState: ProgressState = {
  status: "processing",
  progress: 40,
  currentStage: "Grading 2 of 5 questions complete",
};

const renderModal = (
  overrides: Partial<ProgressState>,
  onCheckResults?: () => void,
) =>
  render(
    <GradingProgressModal
      isOpen
      assignmentId={11}
      attemptId={22}
      progressData={{ ...baseState, ...overrides }}
      onCheckResults={onCheckResults}
    />,
  );

beforeEach(() => {
  mockReportErrorProps.length = 0;
  localStorage.clear();
});

describe("GradingProgressModal error report context identity", () => {
  it("keeps the report context reference stable across a re-render that leaves status and stage unchanged", () => {
    const { rerender } = renderModal({ status: "stalled" });

    // Simulates the real trigger: the modal re-renders (e.g. progress ticking
    // up) while the status and stage the learner is looking at haven't
    // changed. Before the fix, the inline object literal was recreated on
    // every render regardless, which reset any in-progress report form.
    rerender(
      <GradingProgressModal
        isOpen
        assignmentId={11}
        attemptId={22}
        progressData={{ ...baseState, status: "stalled", progress: 55 }}
      />,
    );

    expect(mockReportErrorProps).toHaveLength(2);
    expect(mockReportErrorProps[1]).toBe(mockReportErrorProps[0]);
  });
});

describe("GradingProgressModal stalled state", () => {
  it("keeps the working presentation and tells the learner grading is still running", () => {
    renderModal({
      status: "stalled",
      currentStage:
        "This is taking longer than usual. Your answers are submitted and grading is still running.",
    });

    expect(screen.getByText("Still Grading")).toBeInTheDocument();
    expect(screen.getByText(/taking longer than usual/i)).toBeInTheDocument();
    expect(screen.getByTestId("report-error")).toBeInTheDocument();
  });

  it("still offers the email-when-done escape hatch while stalled", () => {
    renderModal({ status: "stalled" });

    expect(screen.getByText("Get email when done")).toBeInTheDocument();
  });
});

describe("GradingProgressModal disconnected state", () => {
  it("says contact was lost, not that grading failed", () => {
    renderModal({
      status: "disconnected",
      currentStage:
        "We lost contact with the grading service. Your answers were submitted — check your results in a moment.",
    });

    expect(
      screen.getByText("We Lost Contact With Grading"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Grading Failed")).not.toBeInTheDocument();
    expect(screen.getByText(/answers were submitted/i)).toBeInTheDocument();
  });

  it("offers a results re-check and the standard report button", () => {
    const onCheckResults = jest.fn();
    renderModal({ status: "disconnected" }, onCheckResults);

    fireEvent.click(screen.getByText("Check my results"));

    expect(onCheckResults).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("report-error")).toBeInTheDocument();
  });

  it("hides the re-check action when the caller supplies no handler", () => {
    renderModal({ status: "disconnected" });

    expect(screen.queryByText("Check my results")).not.toBeInTheDocument();
  });
});

describe("GradingProgressModal existing states", () => {
  it("still renders the failure state for a real grading failure", () => {
    renderModal({ status: "failed", currentStage: "Grading failed" });

    expect(screen.getByText("Grading Failed")).toBeInTheDocument();
    expect(screen.queryByText("Check my results")).not.toBeInTheDocument();
  });
});

describe("GradingProgressModal unable to grade", () => {
  const failure: NonNullable<ProgressState["failure"]> = {
    kind: "unable_to_grade",
    issues: [
      {
        questionId: 30,
        code: "url_unreachable",
        source: { kind: "url", url: "https://github.com/me/private" },
        retryable: false,
        message: "We couldn't open your link.",
      },
      {
        questionId: 10,
        code: "file_encrypted",
        source: { kind: "file", fileName: "<img src=x onerror=alert(1)>.pdf" },
        retryable: false,
        message: "Password protected.",
      },
    ],
  };

  const renderUnable = (
    props: Partial<React.ComponentProps<typeof GradingProgressModal>> = {},
    stateFailure: ProgressState["failure"] = failure,
  ) =>
    render(
      <GradingProgressModal
        isOpen
        assignmentId={11}
        attemptId={22}
        progressData={{
          status: "unable_to_grade",
          progress: 0,
          currentStage: "Question 1: we couldn't open your link",
          failure: stateFailure,
        }}
        // Randomized order: question 30 is shown first, 10 third.
        questionOrder={[30, 20, 10]}
        {...props}
      />,
    );

  it("shows a yellow 'Unable to grade' warning, not the red failure", () => {
    renderUnable();

    expect(screen.getByText("Unable to grade")).toBeInTheDocument();
    expect(screen.queryByText("Grading Failed")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("unable-to-grade").closest(".bg-amber-50"),
    ).not.toBeNull();
    expect(document.querySelector(".bg-red-500")).toBeNull();
  });

  it("renders the advice in the learner's UI language", async () => {
    setStoredUiLanguage("fr");
    renderUnable();

    expect(
      await screen.findByText("Évaluation impossible"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("unable-to-grade-issue")[0]).toHaveTextContent(
      "https://github.com/me/private",
    );
  });

  it("offers no report button", () => {
    renderUnable();

    expect(screen.queryByTestId("report-error")).not.toBeInTheDocument();
    expect(mockReportErrorProps).toHaveLength(0);
  });

  it("numbers issues by the attempt's display order and lists them in that order", () => {
    renderUnable();

    const rows = screen.getAllByTestId("unable-to-grade-issue");
    expect(rows[0]).toHaveTextContent("Question 1");
    expect(rows[0]).toHaveTextContent(
      "We couldn't open your link (https://github.com/me/private). If the repository is private, make it public so it can be graded",
    );
    expect(rows[1]).toHaveTextContent("Question 3");
    expect(rows[1]).toHaveTextContent("is password-protected");
  });

  it("renders learner file names as text, never as HTML", () => {
    renderUnable();

    expect(document.querySelector("img")).toBeNull();
    expect(
      screen.getAllByText(/<img src=x onerror=alert\(1\)>\.pdf/).length,
    ).toBeGreaterThan(0);
  });

  it("links only safe http(s) URLs", () => {
    renderUnable(
      {},
      {
        kind: "unable_to_grade",
        issues: [
          {
            questionId: 30,
            code: "url_invalid",
            source: { kind: "url", url: "javascript:alert(1)" },
            retryable: false,
            message: "",
          },
          {
            questionId: 20,
            code: "url_blocked",
            source: { kind: "url", url: "https://example.org/work" },
            retryable: false,
            message: "",
          },
        ],
      },
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://example.org/work");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer nofollow");
  });

  it("takes the learner to the question to fix it", () => {
    const onGoToQuestion = jest.fn();
    renderUnable({ onGoToQuestion });

    fireEvent.click(screen.getByText("Fix question 3"));
    expect(onGoToQuestion).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByText("Back to my answers"));
    expect(onGoToQuestion).toHaveBeenLastCalledWith(1);
  });

  it("offers 'Try again' instead when the problem is temporary", () => {
    const onRetry = jest.fn();
    const onGoToQuestion = jest.fn();
    renderUnable(
      { onRetry, onGoToQuestion },
      {
        kind: "unable_to_grade",
        issues: [
          {
            questionId: 20,
            code: "url_temporarily_unavailable",
            source: { kind: "url", url: "https://github.com/me/repo" },
            retryable: true,
            message: "",
          },
        ],
      },
    );

    expect(screen.queryByText(/Fix question/)).not.toBeInTheDocument();
    const buttons = screen.getAllByText("Try again");
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("labels an issue whose question isn't in this attempt without a number", () => {
    renderUnable(
      {},
      {
        kind: "unable_to_grade",
        issues: [
          {
            questionId: 999,
            code: "something_new",
            retryable: false,
            message: "A newer server explains this.",
          },
        ],
      },
    );

    expect(screen.getByText("One of your answers")).toBeInTheDocument();
    expect(
      screen.getByText("A newer server explains this."),
    ).toBeInTheDocument();
  });
});

describe("GradingProgressModal real grading failure", () => {
  it.each([
    ["no failure (older server)", undefined],
    ["kind grading_failed", { kind: "grading_failed" as const, issues: [] }],
  ])("keeps the red 'Grading Failed' screen for %s", (_label, failure) => {
    renderModal({
      status: "failed",
      currentStage: "Grading failed",
      failure,
    });

    expect(screen.getByText("Grading Failed")).toBeInTheDocument();
    expect(document.querySelector(".bg-red-500")).not.toBeNull();
    expect(screen.queryByText("Unable to grade")).not.toBeInTheDocument();
  });
});
