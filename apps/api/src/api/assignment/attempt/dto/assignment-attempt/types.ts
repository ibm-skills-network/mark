import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";

export interface LearnerFileUpload {
  filename: string;
  content: string;
  questionId: number;
  githubUrl?: string;
}
export type slideMetaData = {
  slideNumber: number;
  slideText: string;
  slideImage: string;
};
export interface LearnerPresentationResponse {
  transcript?: string;
  slidesData?: slideMetaData[];
  speechReport?: string;
  contentReport?: string;
  bodyLanguageScore?: number;
  bodyLanguageExplanation?: string;
}
export interface LearnerLiveRecordingFeedback {
  transcript: string;
  speechReport: string;
  contentReport: string;
  bodyLanguageScore: number;
  bodyLanguageExplanation: string;
  question: QuestionDto;
}
