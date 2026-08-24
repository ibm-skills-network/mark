/**
 * @jest-environment jsdom
 */

import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";
import AssignmentFeedback from "../AssignmentFeedback";

const ALL_OFF = {
  showAssignmentScore: false,
  showSubmissionFeedback: false,
  showQuestionScore: false,
  showQuestions: false,
  correctAnswerVisibility: "NEVER" as const,
  showPassFailIndicator: false,
};

describe("AssignmentFeedback verbosity presets", () => {
  beforeEach(() => {
    act(() => {
      useAssignmentFeedbackConfig.setState({ ...ALL_OFF });
    });
    window.localStorage.clear();
  });

  it("classifies everything-off as No Feedback", () => {
    render(<AssignmentFeedback />);
    expect(useAssignmentFeedbackConfig.getState().verbosityLevel).toBe("None");
  });

  it("classifies pass/fail-only as Custom, not No Feedback", () => {
    act(() => {
      useAssignmentFeedbackConfig.setState({ showPassFailIndicator: true });
    });
    render(<AssignmentFeedback />);
    expect(useAssignmentFeedbackConfig.getState().verbosityLevel).toBe(
      "Custom",
    );
  });

  it("turns the pass/fail result off when No Feedback is selected", () => {
    act(() => {
      useAssignmentFeedbackConfig.setState({ showPassFailIndicator: true });
    });
    render(<AssignmentFeedback />);
    fireEvent.click(screen.getByText("No Feedback"));
    const state = useAssignmentFeedbackConfig.getState();
    expect(state.showPassFailIndicator).toBe(false);
    expect(state.verbosityLevel).toBe("None");
  });

  it("reads Full Feedback regardless of the pass/fail flag", () => {
    act(() => {
      useAssignmentFeedbackConfig.setState({
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestionScore: true,
        showQuestions: true,
        correctAnswerVisibility: "ALWAYS",
        showPassFailIndicator: true,
      });
    });
    render(<AssignmentFeedback />);
    expect(useAssignmentFeedbackConfig.getState().verbosityLevel).toBe("Full");
  });
});
