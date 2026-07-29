/**
 * @jest-environment jsdom
 */

import React, { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import GradingProgressModal, {
  type ProgressState,
} from "../GradingProgressModal";

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
  it("keeps the spinner and tells the learner grading is still running", () => {
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
