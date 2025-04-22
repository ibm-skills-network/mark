import {
  BaseQuestionEvaluateModel,
  QuestionAnswerContext,
} from "./base.question.evaluate.model";

export class TrueFalseBasedQuestionEvaluateModel
  implements BaseQuestionEvaluateModel
{
  readonly question: string;
  readonly answer: boolean;
  readonly learnerChoice: boolean;
  readonly totalPoints: number;
  readonly previousQuestionsAnswersContext: QuestionAnswerContext[];
  readonly assignmentInstrctions: string;

  constructor(
    question: string,
    previousQuestionsAnswersContext: QuestionAnswerContext[],
    assignmentInstrctions: string,
    answer: boolean,
    learnerChoice: boolean,
    totalPoints: number,
  ) {
    this.question = question;
    this.answer = answer;
    this.learnerChoice = learnerChoice;
    this.totalPoints = totalPoints;
    this.previousQuestionsAnswersContext = previousQuestionsAnswersContext;
    this.assignmentInstrctions = assignmentInstrctions;
  }

  evaluatePoints(): number {
    let pointsEarned = 0;
    if (this.learnerChoice === this.answer) {
      pointsEarned = this.totalPoints;
    }
    return pointsEarned;
  }
}
