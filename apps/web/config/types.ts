import { ReactNode } from "react";

export type User = {
  userId: string;
  role: "author" | "learner";
  assignmentId: number;
  returnUrl: string;
};
export type Cookies = { [key: string]: string };

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

export type UpdateQuestionStateParams = {
  questionType?: "TEXT" | "URL" | "MULTIPLE_CORRECT" | "UPLOAD";
  maxWordCount?: number;
  questionTitle?: string;
  questionCriteria?: {
    points: number[];
    criteriaDesc: string[];
    criteriaIds: number[];
  };
  maxCharacters?: number;
};

export type QuestionAttemptRequestWithId = QuestionAttemptRequest & {
  id: number;
};
/**
 * This is the type of the response from the backend when submitting a question attempt
 */
export type QuestionAttemptResponse = {
  id: number;
  questionId: number;
  question: string;
  totalPoints?: number;
  feedback?: Feedback[];
};

export type QuestionStatus =
  | "active"
  | "edited"
  | "unedited"
  | "flagged"
  | "unflagged";

export type QuestionType =
  | "TEXT"
  | "EMPTY"
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
  id: number;
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
  choice?: string;
  // for all
  feedback: string;
};

/**
 * used if question type is SINGLE_CORRECT or MULTIPLE_CORRECT
 */
export type Choice = {
  choice: string;
  isCorrect: boolean;
  points: number;
  feedback?: string;
};

type QuestionResponse = {
  id: number;
  assignmentAttemptId: number;
  questionId: number;
  // This probably needs to be changed when we implement the other question types
  learnerResponse: string;
  points: number;
  feedback: Feedback[];
  learnerAnswerChoice?: boolean;
};
export interface BaseQuestion {
  type: QuestionType;
  totalPoints: number;
  numRetries?: number;
  question: string;
  questionResponses?: QuestionResponse[];
}

export interface LearnerGetQuestionResponse extends BaseQuestion {
  id: number;
  // for TEXT only, otherwise null
  maxWords?: number;

  maxCharacters?: number;
  // for SINGLE_CORRECT or MULTIPLE_CORRECT only, otherwise null
  choices?: Choice[];
  status?: QuestionStatus;
  // assignmentId: number;
}

export interface CreateQuestionRequest extends BaseQuestion {
  // used if question type is TEXT
  scoring?: Scoring;
  maxWords?: number;
  // used if question type is TRUE_FALSE
  answer?: boolean;
  // used if question type is SINGLE_CORRECT or MULTIPLE_CORRECT
  choices?: Choice[];
}

// TODO: merge this and the one below
export interface Question extends CreateQuestionRequest {
  // id only exists in questions that came from the backend
  // Questions that users add during a session before saving/publishing
  // will have no id
  id: number;
  assignmentId: number;
  questionOrder?: number[];
  choices?: Choice[];
}

export interface QuestionAuthorStore extends Question {
  maxCharacters?: number;
  index?: number;
  alreadyInBackend?: boolean;
}

/**
 * This is the how the question is stored in the zustand store
 * It is the same as the Question interface, but with the addition of 1 of the question attempt types
 *
 */
export type QuestionStore = LearnerGetQuestionResponse &
  QuestionAttemptRequest & {
    status: QuestionStatus;
    learnerResponse: string;
    // feedback: string[];
  };

export interface GetQuestionResponse extends Question {
  success: boolean;
  error?: string;
}

export enum QuestionDisplayType {
  ONE_PER_PAGE = "ONE_PER_PAGE",
  ALL_PER_PAGE = "ALL_PER_PAGE",
}

export type GradingData = {
  graded: boolean;
  timeEstimateMinutes: number | undefined;
  allotedTimeMinutes?: number | undefined;
  passingGrade: number;
  numAttempts?: number;
  displayOrder?: "DEFINED" | "RANDOM";
  questionDisplay?: QuestionDisplayType;
  strictTimeLimit: boolean;
  updatedAt: number | undefined;
};

export type FeedbackData = {
  verbosityLevel: VerbosityLevels;
  // whether to show the status to the learner
  // showStatus: boolean;
  // whether to show the correct answer to the learner
  // showCorrectAnswer: boolean;
  // whether to show the feedback to the learner
  showSubmissionFeedback: boolean;
  // whether to show the question score to the learner
  showQuestionScore: boolean;
  // whether to show the total assignment score to the learner
  showAssignmentScore: boolean;
  updatedAt: number | undefined;
};

export type ReplaceAssignmentRequest = {
  introduction: string;
  instructions?: string;
  gradingCriteriaOverview?: string;
  graded: boolean;
  numAttempts?: number;
  allotedTimeMinutes?: number;
  timeEstimateMinutes?: number;
  passingGrade: number;
  displayOrder?: "DEFINED" | "RANDOM";
  questionDisplay?: QuestionDisplayType;
  published: boolean;
  questionOrder: number[];
  showAssignmentScore?: boolean; // Should the assignment score be shown to the learner after its submission
  showQuestionScore?: boolean; // Should the question score be shown to the learner after its submission
  showSubmissionFeedback?: boolean; // Should the AI provide feedback when the learner submits a question
  updatedAt: number;
};

export interface Assignment extends ReplaceAssignmentRequest {
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
  createdAt?: string;
};

export interface AssignmentAttemptWithQuestions extends AssignmentAttempt {
  questions: QuestionStore[];
  assignmentDetails: AssignmentDetails;
  grade?: number;
  totalPointsEarned?: number;
  totalPossiblePoints?: number;
  passingGrade?: number;
  name?: string;
}

export interface AssignmentDetails {
  allotedTimeMinutes?: number;
  numAttempts?: number;
  passingGrade?: number;
  name: string;
  questionDisplay?: QuestionDisplayType;
  id: number;
  strictTimeLimit?: boolean;
}

export interface AssignmentDetailsLocal extends AssignmentDetails {
  introduction: string;
  instructions: string;
  gradingCriteriaOverview: string;
  graded: boolean;
  updatedAt: number;
  showAssignmentScore: boolean;
  showQuestionScore: boolean;
  showSubmissionFeedback: boolean;
}

export type BaseBackendResponse = {
  id: number;
  success: boolean;
  error?: string;
};

export interface SubmitAssignmentResponse extends BaseBackendResponse {
  grade?: number;
  showSubmissionFeedback: boolean;
  feedbacksForQuestions?: QuestionAttemptResponse[];
  totalPointsEarned: number;
  totalPossiblePoints: number;
}

export type LearnerAssignmentState =
  | "not-published"
  | "not-started"
  | "in-progress"
  | "completed";

export type VerbosityLevels = "Full" | "Partial" | "None" | "Custom";
export type VerbosityState = {
  verbosity: VerbosityLevels;
  loading: boolean;
};
