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

/**
 * This is the type of the response from the backend when submitting a question attempt
 */
export type QuestionAttemptResponse = {
  id: number;
  totalPoints: number;
  feedback: Feedback[];
};

export type QuestionStatus =
  | "active"
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

export type Criteria = {
  points: number;
  description: string;
};

export type Scoring = {
  type: // | "SINGLE_CRITERIA"
  // | "MULTIPLE_CRITERIA"
  "CRITERIA_BASED" | "LOSS_PER_MISTAKE" | "AI_GRADED";
  criteria?: Criteria[];
};

type Feedback = {
  // for mcq only
  choice: string;
  // for all
  feedback: string;
};

/**
 * used if question type is SINGLE_CORRECT or MULTIPLE_CORRECT
 */
export type Choices = Record<string, boolean>;

type QuestionResponse = {
  id: number;
  assignmentAttemptId: number;
  questionId: number;
  // This probably needs to be changed when we implement the other question types
  learnerResponse: string;
  points: number;
  feedback: Feedback[];
};
export interface BaseQuestion {
  type: QuestionType;
  totalPoints: number;
  numRetries: number;
  question: string;
  questionResponses?: QuestionResponse[];
}

export interface LearnerGetQuestionResponse extends BaseQuestion {
  id: number;
  // assignmentId: number;
}

export interface CreateQuestionRequest extends BaseQuestion {
  // used if question type is TEXT
  scoring?: Scoring;
  maxWords?: number;
  // used if question type is TRUE_FALSE
  answer?: boolean;
  // used if question type is SINGLE_CORRECT or MULTIPLE_CORRECT
  choices?: Choices;
}

// TODO: merge this and the one below
export interface Question extends CreateQuestionRequest {
  // id only exists in auestions that came from the backend
  // Questions that users add during a session before saving/publishing
  // will have no id
  id: number;
  assignmentId: number;
  number?: number;
}

export interface QuestionAuthorStore extends Question {
  alreadyInBackend?: boolean;
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
  questionRetries: number;
  timeEstimate: number;
  passingGrade: number;
  numAttempts?: number;
};

export type ModifyAssignmentRequest = {
  introduction?: string;
  instructions?: string;
  gradingCriteriaOverview?: string;
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

export interface assignmentDetailsStore {
  allotedTimeMinutes?: number;
  numAttempts?: number;
  passingGrade?: number;
  name: string;
  id: number;
}

export type BaseBackendResponse = {
  id: number;
  success: boolean;
  error?: string;
};

export interface submitAssignmentResponse extends BaseBackendResponse {
  grade?: number;
}

export type LearnerAssignmentState =
  | "not-started"
  | "in-progress"
  | "completed";
