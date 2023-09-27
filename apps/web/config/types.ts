export type User = {
  userId: string;
  role: "author" | "learner";
  assignmentId: number;
};

// For submitting a question response to backend (Benny's Implementation)

/**
 * There are 4 groups of question types, each with their own attempt type:
 * 1. Text n URL (only one needed for v1)
 * 2. Single Correct n Multiple Correct
 * 3. True False
 * 4. Upload
 * Each one is stored in the zustand store as a different variable (see stores/learner.ts)
 */
export type QuestionAttemptRequest = {
  // 1. Text n URL
  learnerTextResponse?: string;
  learnerUrlResponse?: string;
  // 2. Single Correct n Multiple Correct
  learnerChoices?: string[];
  // 3. True False
  learnerAnswerChoice?: boolean | undefined;
  // 4. Upload
  learnerFileResponse?: File | undefined;
};

export type QuestionAttemptResponse = {
  id: number;
  totalPoints: number;
  feedback: string[];
};

export type QuestionStatus =
  | "correct"
  | "incorrect"
  | "partiallyCorrect"
  | "edited"
  | "unedited";

export type QuestionType =
  | "TEXT"
  | "SINGLE_CORRECT"
  | "MULTIPLE_CORRECT"
  | "TRUE_FALSE"
  | "URL"
  | "UPLOAD";

export type QuestionTypeDropdown = {
  value: QuestionType;
  label: string;
  description: string;
};

export type Scoring = {
  type: // | "SINGLE_CRITERIA"
  // | "MULTIPLE_CRITERIA"
  "CRITERIA_BASED" | "LOSS_PER_MISTAKE" | "AI_GRADED";
  criteria?: unknown;
};

/**
 * used if question type is SINGLE_CORRECT or MULTIPLE_CORRECT
 */
export type Choice = {
  // key value pair
  [option: string]: boolean;
};
type QuestionResponse = {
  id: number;
  assignmentAttemptId: number;
  questionId: number;
  learnerResponse: string;
  points: number;
  feedback: Record<string, string[]>;
};
export interface BaseQuestion {
  type: QuestionType;
  totalPoints: number;
  numRetries?: number;
  question: string;
  choices?: Choice[];
  questionResponses?: QuestionResponse[];
}

export interface LearnerGetQuestionResponse extends BaseQuestion {
  id: number;
  assignmentId: number;
}

export interface CreateQuestionRequest extends BaseQuestion {
  scoring?: Scoring;
  maxWords?: number;
  // used if question type is TRUE_FALSE
  answer?: boolean;
  // used if question type is SINGLE_CORRECT or MULTIPLE_CORRECT
}

export interface Question extends CreateQuestionRequest {
  id: number;
  assignmentId: number;
}

/**
 * This is the how the question is stored in the zustand store
 * It is the same as the Question interface, but with the addition of 1 of the question attempt types
 *
 */
export type QuestionStore = LearnerGetQuestionResponse &
  QuestionAttemptRequest & {
    // status: QuestionStatus;
    // feedback: string[];
  };

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
  allotedTimeMinutes?: number;
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

export type AssignmentAttempt = {
  id: number;
  assignmentId: number;
  submitted: boolean;
  // number between 0 and 1
  grade?: number;
  // The DateTime at which the attempt window ends (can no longer submit it)
  // example: 2023-12-31T23:59:59Z
  expiresAt?: string;
};

export interface AssignmentAttemptWithQuestions extends AssignmentAttempt {
  questions: QuestionStore[];
}

export type BaseBackendResponse = {
  id: number;
  success: boolean;
  error?: string;
};
