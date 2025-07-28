import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";

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
