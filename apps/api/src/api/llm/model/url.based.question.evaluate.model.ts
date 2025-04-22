import { ResponseType } from "@prisma/client";
import {
  BaseQuestionEvaluateModel,
  QuestionAnswerContext,
} from "./base.question.evaluate.model";

export class UrlBasedQuestionEvaluateModel
  implements BaseQuestionEvaluateModel
{
  readonly question: string;
  readonly urlProvided: string;
  readonly isUrlFunctional: boolean;
  readonly urlBody: string;
  readonly totalPoints: number;
  readonly scoringCriteriaType: string;
  readonly scoringCriteria: object;
  readonly previousQuestionsAnswersContext: QuestionAnswerContext[];
  readonly assignmentInstrctions: string;
  readonly responseType: ResponseType;

  constructor(
    question: string,
    previousQuestionsAnswersContext: QuestionAnswerContext[],
    assignmentInstrctions: string,
    urlProvided: string,
    isUrlFunctional: boolean,
    urlBody: string,
    totalPoints: number,
    scoringCriteriaType: string,
    scoringCriteria: object,
    responseType: ResponseType,
  ) {
    this.question = question;
    this.previousQuestionsAnswersContext = previousQuestionsAnswersContext;
    this.assignmentInstrctions = assignmentInstrctions;
    this.urlProvided = urlProvided;
    this.isUrlFunctional = isUrlFunctional;
    this.urlBody = urlBody;
    this.totalPoints = totalPoints;
    this.scoringCriteriaType = scoringCriteriaType;
    this.scoringCriteria = scoringCriteria;
    this.responseType = responseType;
  }
}
