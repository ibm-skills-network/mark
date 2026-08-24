/**
 * @jest-environment jsdom
 */

import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";
import FeedbackSettings from "../FeedbackSettings";

const DEFAULT_STATE = {
  showSubmissionFeedback: true,
  showQuestionScore: true,
  showAssignmentScore: true,
  showQuestions: true,
  correctAnswerVisibility: "ALWAYS" as const,
};

describe("FeedbackSettings", () => {
  beforeEach(() => {
    act(() => {
      useAssignmentFeedbackConfig.setState(DEFAULT_STATE);
    });
    window.localStorage.clear();
  });

  it("renders every feedback setting", () => {
    render(<FeedbackSettings />);
    expect(screen.getByText("Total assignment score")).toBeInTheDocument();
    expect(screen.getByText("Individual question scores")).toBeInTheDocument();
    expect(
      screen.getByText("Explanation and relevant knowledge"),
    ).toBeInTheDocument();
    expect(screen.getByText("Show Questions")).toBeInTheDocument();
    expect(screen.getByText("Show Correct Answers")).toBeInTheDocument();
  });

  it("titles stay legible in dark mode", () => {
    render(<FeedbackSettings />);
    expect(screen.getByText("Total assignment score").className).toContain(
      "dark:text-white",
    );
    expect(screen.getByText("Show Correct Answers").className).toContain(
      "dark:text-white",
    );
  });

  it("flips the store value when a setting switch is clicked", () => {
    render(<FeedbackSettings />);
    const switches = screen.getAllByRole("switch");
    // Order matches settingsData: assignment score is first.
    fireEvent.click(switches[0]);
    expect(useAssignmentFeedbackConfig.getState().showAssignmentScore).toBe(
      false,
    );
    fireEvent.click(switches[0]);
    expect(useAssignmentFeedbackConfig.getState().showAssignmentScore).toBe(
      true,
    );
  });

  it("shows the when-to-show options only while correct answers are enabled", () => {
    render(<FeedbackSettings />);
    expect(screen.getByText("Always show")).toBeInTheDocument();
    expect(screen.getByText("Show only on pass")).toBeInTheDocument();

    // The correct-answers toggle is the only checkbox besides the radios.
    fireEvent.click(screen.getByRole("checkbox"));
    expect(useAssignmentFeedbackConfig.getState().correctAnswerVisibility).toBe(
      "NEVER",
    );
    expect(screen.queryByText("Always show")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(useAssignmentFeedbackConfig.getState().correctAnswerVisibility).toBe(
      "ALWAYS",
    );
  });

  it("switches visibility to on-pass via the radio options", () => {
    render(<FeedbackSettings />);
    fireEvent.click(screen.getByLabelText(/Show only on pass/));
    expect(useAssignmentFeedbackConfig.getState().correctAnswerVisibility).toBe(
      "ON_PASS",
    );
    fireEvent.click(screen.getByLabelText(/Always show/));
    expect(useAssignmentFeedbackConfig.getState().correctAnswerVisibility).toBe(
      "ALWAYS",
    );
  });

  it("shows the live passing threshold on the pass/fail toggle", () => {
    act(() => {
      useAssignmentConfig.setState({ passingGrade: 70 });
    });
    render(<FeedbackSettings />);
    expect(
      screen.getByText(
        "The learner will be told whether they passed (score of 70% or higher), even when scores are hidden.",
      ),
    ).toBeInTheDocument();
  });

  it("falls back to the 50% default when the threshold is unset", () => {
    act(() => {
      useAssignmentConfig.setState({ passingGrade: 0 });
    });
    render(<FeedbackSettings />);
    expect(
      screen.getByText(
        "The learner will be told whether they passed (score of 50% or higher), even when scores are hidden.",
      ),
    ).toBeInTheDocument();
  });

  it("clears cached question state when correct-answer visibility changes", () => {
    window.localStorage.setItem("questions", "[]");
    window.localStorage.setItem("assignmentConfig", "{}");
    render(<FeedbackSettings />);
    fireEvent.click(screen.getByLabelText(/Show only on pass/));
    expect(window.localStorage.getItem("questions")).toBeNull();
    expect(window.localStorage.getItem("assignmentConfig")).toBeNull();
  });
});
