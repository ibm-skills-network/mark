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
  Attempts: number;
};
