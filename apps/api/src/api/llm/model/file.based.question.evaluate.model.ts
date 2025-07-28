import { QuestionType, ResponseType } from "@prisma/client";
import { ScoringDto } from "src/api/assignment/dto/update.questions.request.dto";
import { LearnerFileUpload } from "src/api/attempt/common/interfaces/attempt.interface";
import {
  BaseQuestionEvaluateModel,
  QuestionAnswerContext,
} from "./base.question.evaluate.model";

export class FileUploadQuestionEvaluateModel
  implements BaseQuestionEvaluateModel
{
  readonly question: string;
  readonly learnerResponse: LearnerFileUpload[];
  readonly totalPoints: number;
  readonly scoringCriteriaType: string;
  readonly scoringCriteria: ScoringDto;
  readonly previousQuestionsAnswersContext: QuestionAnswerContext[];
  readonly assignmentInstrctions: string;
  readonly questionType: QuestionType;
  readonly responseType: ResponseType;

  constructor(
    question: string,
    previousQuestionsAnswersContext: QuestionAnswerContext[],
    assignmentInstrctions: string,
    learnerResponse: LearnerFileUpload[],
    totalPoints: number,
    scoringCriteriaType: string,
    scoringCriteria: ScoringDto,
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
