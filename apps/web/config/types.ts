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
