import { QuestionType, ResponseType } from "@prisma/client";
import { LearnerPresentationResponse } from "src/api/assignment/attempt/dto/assignment-attempt/types";
import {
  BaseQuestionEvaluateModel,
  QuestionAnswerContext,
} from "./base.question.evaluate.model";

export class PresentationQuestionEvaluateModel
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
  }
}
