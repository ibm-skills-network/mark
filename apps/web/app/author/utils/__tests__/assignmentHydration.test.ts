import {
  getAssignmentConfigHydration,
  getAssignmentFeedbackHydration,
} from "../assignmentHydration";
import type { Assignment } from "@/config/types";

const mockAssignment = {
  id: 1,
  name: "Test Assignment",
  numAttempts: 3,
  retakeAttemptCoolDownMinutes: 10,
  attemptsBeforeCoolDown: 2,
  passingGrade: 70,
  displayOrder: "DEFINED",
  graded: true,
  questionDisplay: "ONE_PER_PAGE",
  questionVariationNumber: 0,
  timeEstimateMinutes: 30,
  allotedTimeMinutes: 60,
  showQuestions: true,
  showSubmissionFeedback: true,
  requireAllQuestions: false,
  optionalQuestionIds: [1, 2],
  numberOfQuestionsPerAttempt: 5,
  questionControls: {
    disableCopy: false,
    disablePaste: false,
    disableRightClick: false,
    disablePrint: false,
  },
  showQuestionScore: true,
  showAssignmentScore: false,
  correctAnswerVisibility: "ALWAYS",
} as unknown as Assignment;

describe("getAssignmentConfigHydration", () => {
  it("maps grading config fields", () => {
    const result = getAssignmentConfigHydration(mockAssignment);
    expect(result.numAttempts).toBe(3);
    expect(result.passingGrade).toBe(70);
    expect(result.graded).toBe(true);
    expect(result.attemptsBeforeCoolDown).toBe(2);
    expect(result.retakeAttemptCoolDownMinutes).toBe(10);
  });

  it("maps display and timing config fields", () => {
    const result = getAssignmentConfigHydration(mockAssignment);
    expect(result.displayOrder).toBe("DEFINED");
    expect(result.questionDisplay).toBe("ONE_PER_PAGE");
    expect(result.timeEstimateMinutes).toBe(30);
    expect(result.allotedTimeMinutes).toBe(60);
    expect(result.numberOfQuestionsPerAttempt).toBe(5);
  });

  it("maps questionControls", () => {
    const result = getAssignmentConfigHydration(mockAssignment);
    expect(result.questionControls).toEqual(mockAssignment.questionControls);
  });

  it("maps optional question fields", () => {
    const result = getAssignmentConfigHydration(mockAssignment);
    expect(result.requireAllQuestions).toBe(false);
    expect(result.optionalQuestionIds).toEqual([1, 2]);
    expect(result.showQuestions).toBe(true);
    expect(result.showSubmissionFeedback).toBe(true);
  });

  it("does not include feedback-only fields", () => {
    const result = getAssignmentConfigHydration(mockAssignment);
    expect("showQuestionScore" in result).toBe(false);
    expect("showAssignmentScore" in result).toBe(false);
    expect("correctAnswerVisibility" in result).toBe(false);
  });
});

describe("getAssignmentFeedbackHydration", () => {
  it("maps all feedback visibility fields", () => {
    const result = getAssignmentFeedbackHydration(mockAssignment);
    expect(result.showSubmissionFeedback).toBe(true);
    expect(result.showQuestionScore).toBe(true);
    expect(result.showAssignmentScore).toBe(false);
    expect(result.showQuestions).toBe(true);
    expect(result.correctAnswerVisibility).toBe("ALWAYS");
  });

  it("does not include grading fields", () => {
    const result = getAssignmentFeedbackHydration(mockAssignment);
    expect("passingGrade" in result).toBe(false);
    expect("numAttempts" in result).toBe(false);
    expect("questionControls" in result).toBe(false);
  });

  it("passes through null/undefined values faithfully", () => {
    const assignment = {
      ...mockAssignment,
      showAssignmentScore: undefined,
      correctAnswerVisibility: undefined,
    } as unknown as Assignment;
    const result = getAssignmentFeedbackHydration(assignment);
    expect(result.showAssignmentScore).toBeUndefined();
    expect(result.correctAnswerVisibility).toBeUndefined();
  });
});
