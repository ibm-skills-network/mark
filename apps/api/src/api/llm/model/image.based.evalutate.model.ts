import { QuestionType, ResponseType } from "@prisma/client";
import { ScoringDto } from "src/api/assignment/dto/update.questions.request.dto";
import {
  BaseQuestionEvaluateModel,
  QuestionAnswerContext,
} from "./base.question.evaluate.model";

export interface LearnerImageUpload {
  imageUrl: string;
  filename: string;
  mimeType: string;
  imageAnalysisResult: ImageAnalysisResult;
  imageData: string;
  imageBucket?: string;
  imageKey?: string;
}
/**
 * Model that holds data for evaluating an image-based question.
 */
export class ImageBasedQuestionEvaluateModel
  implements BaseQuestionEvaluateModel
{
  /**
   * Image response from learner. Each image is base64 encoded with metadata.
   */
  public learnerImageResponse: LearnerImageUpload[];
  question: string;
  totalPoints: number;
  scoringCriteriaType: string;
  scoringCriteria: ScoringDto;
  questionType: QuestionType;
  responseType: ResponseType;
  imageData: string;
  learnerResponse: string;
  imageBucket?: string;
  imageKey?: string;

  constructor(
    question: string,
    previousQuestionsAnswersContext: QuestionAnswerContext[],
    assignmentInstrctions: string,
    learnerImageResponse: LearnerImageUpload[],
    totalPoints: number,
    scoringCriteriaType: string,
    scoringCriteria: ScoringDto,
    questionType: QuestionType = QuestionType.UPLOAD,
    responseType: ResponseType = ResponseType.OTHER,
    imageData: string,
    learnerResponse: string,
  ) {
    this.question = question;
    this.previousQuestionsAnswersContext = previousQuestionsAnswersContext;
    this.assignmentInstrctions = assignmentInstrctions;
    this.learnerImageResponse = learnerImageResponse;
    this.totalPoints = totalPoints;
    this.scoringCriteriaType = scoringCriteriaType;
    this.scoringCriteria = scoringCriteria;
    this.questionType = questionType;
    this.responseType = responseType;
    this.imageData = imageData;
    this.learnerResponse = learnerResponse;
  }
  previousQuestionsAnswersContext: QuestionAnswerContext[];
  assignmentInstrctions: string;
}

/**
 * Represents the result of analyzing an image, which can be provided
 * to the LLM for grading assistance.
 */
export interface ImageAnalysisResult {
  width: number;
  height: number;
  aspectRatio: number;
  fileSize: number;

  dominantColors?: string[];
  brightness?: number;
  contrast?: number;
  sharpness?: number;

  detectedObjects?: {
    label: string;
    confidence: number;
    boundingBox?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }[];

  detectedText?: {
    text: string;
    confidence: number;
    boundingBox?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }[];

  technicalQuality?: {
    exposureScore?: number;
    noiseLevel?: number;
    compositionScore?: number;
  };

  sceneType?: string;

  rawDescription?: string;

  additionalData?: Record<string, any>;
}
