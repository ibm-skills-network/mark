export type User = {
  username: string;
  role: "author" | "learner" | "admin";
  assignmentID: number;
};

export type QuestionStatus =
  | "correct"
  | "incorrect"
  | "partiallyCorrect"
  | "unanswered";

export type GradingData = {
  isGraded: boolean;
  timeEstimate: number;
  passingGrade: number;
  attempts: number;
};

export type Assignment = {
  name?: string;
  type?: "AI_GRADED" | "MANUAL";
  numAttempts?: number;
  allotedTime?: number;
  passingGrade?: number;
  displayOrder?: "DEFINED" | "RANDOM";
};

export type AssignmentBackendResponse = {
  id: number;
  success: boolean;
  error?: string;
};
