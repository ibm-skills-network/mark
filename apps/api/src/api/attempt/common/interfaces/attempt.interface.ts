import {
  Choice,
  QuestionDto,
} from "src/api/assignment/dto/update.questions.request.dto";

/**
 * Interface for assignment attempt grading results
 */
export interface GradingResult {
  grade: number;
  totalPointsEarned: number;
  totalPossiblePoints: number;
}

/**
 * Interface for assignment context used in grading
 */
export interface AssignmentContext {
  assignmentInstructions: string;
  questionAnswerContext: QuestionAnswerContext[];
}

/**
 * Interface for question-answer context
 */
export interface QuestionAnswerContext {
  question: string;
  answer: string;
}
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
/**
 * Interface for learner file upload
 */
export interface LearnerFileUpload {
  filename: string;
  content: string;
  questionId?: number;
  fileType?: string;
  bucket?: string;
  githubUrl?: string;
  recordId?: number;
  key?: string;
  path?: string;
  repo?: RepoType;
  owner?: string;
  blob?: Blob;
}

/**
 * Interface for slide metadata in presentation responses
 */
export interface SlideMetadata {
  slideNumber: number;
  slideText: string;
  slideImage: string;
  videoUrl?: string;
  audioUrl?: string;
  slideTitle?: string;
  slideNotes?: string;
  duration?: number;
}

/**
 * Interface for learner presentation response
 */
export interface LearnerPresentationResponse {
  transcript?: string;
  slidesData?: SlideMetadata[];
  speechReport?: string;
  contentReport?: string;
  bodyLanguageScore?: number;
  bodyLanguageExplanation?: string;
}

/**
 * Interface for learner live recording feedback
 */
export interface LearnerLiveRecordingFeedback {
  transcript: string;
  speechReport: string;
  contentReport: string;
  bodyLanguageScore: number;
  bodyLanguageExplanation: string;
  question: QuestionDto;
}

/**
 * Interface for translated question
 */
export interface TranslatedQuestion {
  id: number;
  question: string;
  choices?: Choice[];
  languageCode: string;
}

/**
 * Interface for URL fetch response
 */
export interface UrlFetchResponse {
  body: string;
  isFunctional: boolean;
}

/**
 * Interface for question variant data
 */
export interface QuestionVariantData {
  assignmentAttemptId: number;
  questionId: number;
  questionVariantId?: number;
  randomizedChoices?: string;
}
