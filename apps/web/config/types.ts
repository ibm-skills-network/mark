import { learnerFileResponse } from "@/stores/learner";

export type User = {
  userId: string;
  role: "author" | "learner";
  assignmentId: number;
  returnUrl: string;
  launch_presentation_locale?: string;
};
export type Cookies = { [key: string]: string };
export interface LearnerFileResponse {
  filename: string;
  imageUrl?: string;
  imageData?: string;
  imageBucket?: string;
  imageKey?: string;
  mimeType?: string;
  imageAnalysisResult?: {
    width: number;
    height: number;
    aspectRatio: number;
    fileSize: number;
    dominantColors: any[];
    detectedObjects: any[];
    detectedText: any[];
    sceneType: string;
    rawDescription: string;
  };

  content?: string;
  key?: string;
  bucket?: string;
  fileType?: string;
  githubUrl?: string;
}
export interface EnhancedFileObject {
  id: string;
  fileName: string;
  content?: string;
  imageUrl?: string;
  imageBucket?: string;
  imageKey?: string;
  fileType?: string;
  cosKey: string;
  cosBucket: string;
  path: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  fileSize?: number;
}

export interface ExtendedFileContent {
  content?: string;
  url?: string;
  error?: string;
  filename?: string;
  type?: string;
  contentUrl?: string;
  fileImageUrl?: string;
  finalUrl?: string;
  questionId?: string;
}

export type UploadType = "author" | "learner" | "debug";

export interface UploadContext {
  path?: string;
  assignmentId?: number;
  questionId?: number;
  reportId?: number;
  [key: string]: string | number | undefined;
}

export interface UploadRequest {
  fileName: string;
  fileType: string;
  uploadType: UploadType;
  context?: UploadContext;
}

export interface UploadResponse {
  presignedUrl: string;
  key: string;
  bucket: string;
  fileType: string;
  fileName: string;
  uploadType: string;
}

export interface FileMetadata {
  cosKey: string;
  cosBucket: string;
  fileName: string;
  fileType: string;
  contentType: string;
}

export interface FileResponse {
  id: string;
  fileName: string;
  fileType: string;
  cosKey: string;
  cosBucket: string;
  fileSize?: number;
  createdAt: string;
  path: string;
}

export interface FolderListing {
  folder: string;
  files: Array<{ key?: string; size?: number; lastModified?: Date }>;
  subfolders: string[];
  presignedUrl?: string;
}

export interface CreateFolderRequest {
  name: string;
  path: string;
  uploadType: UploadType;
  context?: Record<string, unknown>;
}

export interface MoveFileRequest {
  fileId?: string;
  uploadType: UploadType;
  sourceKey?: string;
  targetPath: string;
  bucket?: string;
}

export interface RenameFileRequest {
  fileId?: string;
  uploadType: string;
  sourceKey?: string;
  newFileName: string;
  bucket?: string;
}

export interface DirectUploadResponse {
  success: boolean;
  key: string;
  bucket: string;
  etag?: string;
}

export interface FileAccessResponse {
  presignedUrl: string;
  fileName: string;
  fileType: string;
  contentType: string;
}
/**
 * There are 4 groups of question types, each with their own attempt type:
 * 1. Text n URL (only one needed for v1)
 * 2. Single Correct n Multiple Correct
 * 3. True False
 * 4. Upload
 * Each one is stored in the zustand store as a different variable (see stores/learner.ts)
 */
export type QuestionAttemptRequest = {
  learnerTextResponse?: string;
  learnerUrlResponse?: string;

  learnerChoices?: string[];

  learnerAnswerChoice?: boolean | undefined;

  learnerFileResponse?: learnerFileResponse[] | undefined;
  learnePresentationResponse?: PresentationQuestionResponse;
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
  showQuestions: boolean;
  updatedAt: number;
  numberOfQuestionsPerAttempt?: number;
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
  totalPoints?: number;
  randomizedChoices?: boolean;
  maxWordCount?: number;
  questionTitle?: string;
  showRubricsToLearner?: boolean;
  //if the points will be shown in the rubric
  showPoints?: boolean;
  rubrics?: Rubric[];
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
  | "LINK_FILE";

export type ResponseType =
  | "CODE"
  | "ESSAY"
  | "REPORT"
  | "PRESENTATION"
  | "IMAGES"
  | "VIDEO"
  | "AUDIO"
  | "REPO"
  | "SPREADSHEET"
  | "LIVE_RECORDING"
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

export interface Rubric {
  rubricQuestion: string;
  criteria: Criteria[];
  showPoints?: boolean;
}

export type AssignmentFeedback = {
  assignmentId: number;
  userId: string;
  comments: string;
  assignmentRating: number;
  aiGradingRating: number;
  allowContact?: boolean;
  firstName?: string;
  lastName?: string;
  email?: string;
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
export type TranscriptSegment = {
  start: number | string;
  end: number | string;
  text: string;
  avg_logprob: number;
  no_speech_prob: number;
};
export type TranscriptionResult = {
  text: string;
  segments: Array<{
    start: number;
    end: number;
    text: string;
    avg_logprob: number;
    no_speech_prob: number;
  }>;
};
export type Scoring = {
  type: "CRITERIA_BASED" | "LOSS_PER_MISTAKE" | "AI_GRADED";
  rubrics?: Rubric[];
  criteria?: Criteria[];
  showRubricsToLearner?: boolean;
  showPoints?: boolean;
};

type Feedback = {
  choice?: string;

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

  learnerResponse: string;
  points: number;
  feedback: Feedback[];
  learnerAnswerChoice?: boolean;
};
export interface BaseQuestion {
  type: QuestionType;
  scoring?: Scoring;
  totalPoints: number;
  numRetries?: number;
  question: string;
  questionResponses?: QuestionResponse[];
  responseType?: ResponseType;
}

export interface LearnerGetQuestionResponse extends BaseQuestion {
  id: number;

  maxWords?: number;

  maxCharacters?: number;

  choices?: Choice[];
  status?: QuestionStatus;
  translations?: {
    [key: string]: {
      translatedText: string;
      translatedChoices: Choice[];
    };
  };
}

export interface CreateQuestionRequest extends BaseQuestion {
  scoring?: Scoring;
  maxWords?: number;

  answer?: boolean;

  choices?: Choice[];
}
export interface videoPresentationConfig {
  evaluateSlidesQuality: boolean;
  evaluateTimeManagement: boolean;
  targetTime: number;
}
export interface LiveRecordingConfig {
  evaluateBodyLanguage: boolean;
  realTimeAiCoach: boolean;
  evaluateTimeManagement: boolean;
  targetTime: number;
}

export interface Question extends CreateQuestionRequest {
  id: number;
  assignmentId: number;
  questionOrder?: number[];
  variants?: QuestionVariants[];
  randomizedChoices?: boolean;
  alreadyInBackend?: boolean;
  videoPresentationConfig?: videoPresentationConfig;
  liveRecordingConfig?: LiveRecordingConfig;
}
export interface PublishJobResponse {
  jobId: string;
  progress: string;
  status: string;
  result?: string;
  percentage?: number;
  done?: boolean;
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
export enum RubricType {
  COMPREHENSIVE = "COMPREHENSIVE",
  MULTI = "MULTI",
}

export interface QuestionAuthorStore extends Question {
  maxCharacters?: number;
  index?: number;
  alreadyInBackend?: boolean;
  showPoints?: boolean;
  //set with a button on the frontend
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
    answers?: string[];
    presentationResponse?: PresentationQuestionResponse;
    videoPresentationConfig?: videoPresentationConfig;
    liveRecordingConfig?: LiveRecordingConfig;
  };

export type slideMetaData = {
  slideNumber: number;
  slideText: string;
  slideImage: string;
};

export type PresentationQuestionResponse = {
  transcript?: string;
  slidesData?: slideMetaData[];
  speechReport?: string;
  contentReport?: string;
  bodyLanguageScore?: number;
  bodyLanguageExplanation?: string;
};

export type LiveRecordingData = {
  transcript?: string;
  speechReport?: string;
  contentReport?: string;
  bodyLanguageScore?: number;
  bodyLanguageExplanation?: string;
  question: QuestionStore;
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
  showQuestions: boolean;
  showSubmissionFeedback: boolean;
  showAssignmentScore: boolean;
  numberOfQuestionsPerAttempt?: number | undefined;
};

export type FeedbackData = {
  verbosityLevel: VerbosityLevels;

  showSubmissionFeedback: boolean;

  showQuestionScore: boolean;
  showQuestions: boolean;

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
  numberOfQuestionsPerAttempt?: number;
  published: boolean;
  questions?: Question[];
  questionOrder: number[];
  showQuestions?: boolean;
  showAssignmentScore?: boolean;
  showQuestionScore?: boolean;
  showSubmissionFeedback?: boolean;
  updatedAt: number;
  questionVariationNumber?: number;
};

export interface Assignment extends ReplaceAssignmentRequest {
  id: number;
  name: string;
  type?: "AI_GRADED" | "MANUAL";
}
export type IssueSeverity = "info" | "warning" | "error" | "critical";

export interface GetAssignmentResponse extends Assignment {
  success: boolean;
  error?: string;
}

export type AssignmentAttempt = {
  id: number;
  assignmentId: number;
  submitted: boolean;

  grade?: number;

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
  showQuestions?: boolean;
  showQuestionScore?: boolean;
  comments?: string;
  preferredLanguage?: string;
}

export interface AssignmentDetails {
  allotedTimeMinutes?: number;
  numAttempts?: number;
  passingGrade?: number;
  name: string;
  questionDisplay?: QuestionDisplayType;
  id: number;
  strictTimeLimit?: boolean;
  introduction?: string;
  graded?: boolean;
  published?: boolean;
  questionOrder?: number[];
  updatedAt?: number;
  showQuestions?: boolean;
  showAssignmentScore?: boolean;
  showQuestionScore?: boolean;
  showSubmissionFeedback?: boolean;
  numberOfQuestionsPerAttempt?: number;
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
  gradingJobId?: string;
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
  url: number;
  upload: number;
  linkFile: number;
  responseTypes: {
    TEXT: ResponseType;
    URL: ResponseType;
    UPLOAD: ResponseType;
    LINK_FILE: ResponseType;
  };
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
