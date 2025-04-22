import { QuestionType, ResponseType } from "@prisma/client";
import { LearnerPresentationResponse } from "src/api/assignment/attempt/dto/assignment-attempt/types";
import { VideoPresentationConfig } from "src/api/assignment/dto/update.questions.request.dto";
import {
  BaseQuestionEvaluateModel,
  QuestionAnswerContext,
} from "./base.question.evaluate.model";

export class VideoPresentationQuestionEvaluateModel
  implements BaseQuestionEvaluateModel
{
  readonly question: string;
  readonly learnerResponse: LearnerPresentationResponse;
  readonly totalPoints: number;
  readonly scoringCriteriaType: string;
  readonly scoringCriteria: object;
  readonly previousQuestionsAnswersContext: QuestionAnswerContext[];
  readonly assignmentInstrctions: string;
  readonly questionType: QuestionType;
  readonly responseType: ResponseType;
  readonly videoPresentationConfig: VideoPresentationConfig;

  constructor(
    question: string,
    previousQuestionsAnswersContext: QuestionAnswerContext[],
    assignmentInstrctions: string,
    learnerResponse: LearnerPresentationResponse,
    totalPoints: number,
    scoringCriteriaType: string,
    scoringCriteria: object,
    questionType: QuestionType,
    responseType: ResponseType,
    videoPresentationConfig: {
      evaluateSlidesQuality: boolean;
      evaluateTimeManagement: boolean;
      targetTime: number;
    },
  ) {
    this.question = question;
    this.previousQuestionsAnswersContext = previousQuestionsAnswersContext;
    this.assignmentInstrctions = assignmentInstrctions;
    this.learnerResponse = learnerResponse;
    this.totalPoints = totalPoints;
    this.scoringCriteriaType = scoringCriteriaType;
    this.scoringCriteria = scoringCriteria;
    this.questionType = questionType;
    this.responseType = responseType;
    this.videoPresentationConfig = videoPresentationConfig;
  }
}
