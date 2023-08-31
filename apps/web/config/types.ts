export type User = {
  username: string;
  role: "author" | "learner" | "admin";
  assignmentID: number;
};

// For submitting a question response to backend (Benny's Implementation)

export type QuestionResponse = {
  learnerTextResponse?: string;
  learnerUrlResponse?: string;
  learnerChoices?: string[];
  learnerAnswerChoice?: boolean;
  learnerFileResponse?: File;
};

export type QuestionStatus =
  | "correct"
  | "incorrect"
  | "partiallyCorrect"
  | "answered"
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

/**
 * used if question type is SINGLE_CORRECT or MULTIPLE_CORRECT
 */
export type Choice = {
  // key value pair
  [option: string]: boolean;
};

export type CreateQuestionRequest = {
  type: QuestionType;
  totalPoints: number;
  numRetries?: number;
  question: string;
  scoring?: Scoring;
  maxWords?: number;
  // used if question type is TRUE_FALSE
  answer?: boolean;
  // used if question type is SINGLE_CORRECT or MULTIPLE_CORRECT
  choices?: Choice[];
};

export interface Question extends CreateQuestionRequest {
  id: number;
  assignmentID: number;
}

export interface GetQuestionResponse extends Question {
  success: boolean;
  error?: string;
}

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

export type BaseBackendResponse = {
  id: number;
  success: boolean;
  error?: string;
};
