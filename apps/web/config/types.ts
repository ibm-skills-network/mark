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

export type QuestionType =
  | "TEXT"
  | "SINGLE_CORRECT"
  | "MULTIPLE_CORRECT"
  | "TRUE_FALSE"
  | "URL"
  | "UPLOAD";

export type Scoring = {
  type:
    | "SINGLE_CRITERIA"
    | "MULTIPLE_CRITERIA"
    | "LOSS_PER_MISTAKE"
    | "AI_GRADED";
  criteria?: unknown;
};

export type Choice = {
  // key value pair
  [option: string]: boolean;
};

export type Question = {
  type: QuestionType;
  totalPoints: number;
  numRetries?: number;
  question: string;
  scoring?: Scoring;
  answer?: string;
  id: number;
  assignmentID: number;
  success: boolean;
  error?: string;
  choices?: Choice[];
};

export type GradingData = {
  graded: boolean;
  timeEstimate: number;
  passingGrade: number;
  attempts: number;
};

export type ModifyAssignmentRequest = {
  introduction?: string;
  instructions?: string;
  graded?: boolean;
  numAttempts?: number;
  allotedTime?: number;
  passingGrade?: number;
  displayOrder?: "DEFINED" | "RANDOM";
};

export interface Assignment extends ModifyAssignmentRequest {
  id: number;
  name?: string;
  type?: "AI_GRADED" | "MANUAL";
  questions: Question[];
}

export interface GetAssignmentResponse extends Assignment {
  success: boolean;
  error?: string;
}

export type AssignmentBackendResponse = {
  id: number;
  success: boolean;
  error?: string;
};
