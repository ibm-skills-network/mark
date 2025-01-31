import { learnerFileResponse } from "@/stores/learner";

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
  learnerFileResponse?: learnerFileResponse[] | undefined;
};
export type RepoType = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: {
    login: string;
  };
  license?: {
    key?: string;
    name?: string;
    spdx_id?: string;
    url?: string;
    node_id?: string;
  };
  default_branch?: string;
};
export type RepoContentItem = {
  type: "file" | "dir" | "symlink" | "submodule";
  name: string;
  path: string;
  sha: string;
  url: string;
  download_url: string | null;
  repo: RepoType;
  owner: {
    login: string;
  };
};
export type AuthorAssignmentState = {
  assignmentId: number;
  assignmentType: AssignmentTypeEnum;
  questions: QuestionAuthorStore[];
  questionOrder: number[];
  introduction: string;
  instructions: string;
  gradingCriteriaOverview: string;
  graded: boolean;
  numAttempts: number;
  allotedTimeMinutes: number;
  timeEstimateMinutes: number;
  passingGrade: number;
  displayOrder: "DEFINED" | "RANDOM";
  questionDisplay: QuestionDisplayType;
  published: boolean;
  showAssignmentScore: boolean;
  showQuestionScore: boolean;
  showSubmissionFeedback: boolean;
  updatedAt: number;
};
export type AuthorFileUploads = {
  filename: string;
  content: string;
  size: number;
  tokenCount: number;
  githubUrl?: string;
};

export type UpdateQuestionStateParams = {
  questionType?: QuestionType;
  responseType?: ResponseType;
  randomizedChoices?: boolean;
  maxWordCount?: number;
  questionTitle?: string;
  questionCriteria?: {
    points: number[];
    criteriaDesc: string[];
    criteriaIds: number[];
  };
  maxCharacters?: number;
  variant?: QuestionVariants;
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
  | "UPLOAD"
  | "CODE"
  | "LINK_FILE"
  | "IMAGES";

export type ResponseType =
  | "CODE"
  | "ESSAY"
  | "REPORT"
  | "PRESENTATION"
  | "VIDEO"
  | "AUDIO"
  | "REPO"
  | "SPREADSHEET"
  | "OTHER";

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
export type AssignmentFeedback = {
  assignmentId: number;
  userId: string;
  comments: string;
  assignmentRating: number;
  aiGradingRating: number;
};
export type RegradingRequest = {
  assignmentId: number;
  userId: string;
  attemptId: number;
  reason: string;
};

export enum REPORT_TYPE {
  BUG = "BUG",
  FEEDBACK = "FEEDBACK",
  SUGGESTION = "SUGGESTION",
  PERFORMANCE = "PERFORMANCE",
  FALSE_MARKING = "FALSE_MARKING",
  OTHER = "OTHER",
}

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
  responseType?: ResponseType;
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
  variants?: QuestionVariants[];
  randomizedChoices?: boolean;
}

export interface QuestionVariants {
  id: number;
  questionId: number;
  type: QuestionType;
  variantContent: string;
  choices: string | Choice[];
  maxWords?: number;
  scoring?: Scoring;
  answer?: boolean;
  maxCharacters?: number;
  createdAt: string;
  difficultyLevel?: number;
  randomizedChoices?: boolean;
  variantType: "REWORDED" | "REPHRASED";
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
    translationOn: boolean;
    selectedLanguage: string;
    translatedQuestion: string;
    translatedChoices: Choice[];
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
  questionVariationNumber: number;
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
  questions?: Question[];
  questionOrder: number[];
  showAssignmentScore?: boolean; // Should the assignment score be shown to the learner after its submission
  showQuestionScore?: boolean; // Should the question score be shown to the learner after its submission
  showSubmissionFeedback?: boolean; // Should the AI provide feedback when the learner submits a question
  updatedAt: number;
  questionVariationNumber?: number;
};

export interface Assignment extends ReplaceAssignmentRequest {
  id: number;
  name?: string;
  type?: "AI_GRADED" | "MANUAL";
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
  message?: string;
};

export interface AssignmentAttemptWithQuestions extends AssignmentAttempt {
  questions: QuestionStore[];
  assignmentDetails: AssignmentDetails;
  grade?: number;
  totalPointsEarned?: number;
  totalPossiblePoints?: number;
  passingGrade?: number;
  name?: string;
  showSubmissionFeedback?: boolean;
  showAssignmentScore?: boolean;
  showQuestionScore?: boolean;
  comments?: string;
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
  message?: string;
};
export type UpdateAssignmentQuestionsResponse = BaseBackendResponse & {
  questions?: Question[];
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
interface QuestionsToGenerate {
  multipleChoice: number;
  multipleSelect: number;
  textResponse: number;
  trueFalse: number;
}
export interface QuestionGenerationPayload {
  assignmentId: number;
  assignmentType: AssignmentTypeEnum;
  questionsToGenerate: QuestionsToGenerate;
  fileContents: AuthorFileUploads[];
  learningObjectives: string;
}
export enum AssignmentTypeEnum {
  PRACTICE = "PRACTICE",
  QUIZ = "QUIZ",
  ASSINGMENT = "ASSINGMENT",
  MIDTERM = "MIDTERM",
  FINAL = "FINAL",
}
