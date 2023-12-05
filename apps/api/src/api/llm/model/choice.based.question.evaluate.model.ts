import { Choice } from "src/api/assignment/question/dto/create.update.question.request.dto";
import {
  BaseQuestionEvaluateModel,
  QuestionAnswerContext,
} from "./base.question.evaluate.model";

export class ChoiceBasedQuestionEvaluateModel
  implements BaseQuestionEvaluateModel
{
  readonly question: string;
  readonly validChoices: Choice[];
  readonly learnerChoices: string[];
  readonly totalPoints: number;
  readonly scoringCriteriaType?: string;
  readonly scoringCriteria?: object;
  readonly previousQuestionsAnswersContext: QuestionAnswerContext[];
  readonly assignmentInstrctions: string;

  constructor(
    question: string,
    previousQuestionsAnswersContext: QuestionAnswerContext[],
    assignmentInstrctions: string,
    validChoices: Choice[],
    learnerChoices: string[],
    totalPoints: number,
    scoringCriteriaType?: string,
    scoringCriteria?: object
  ) {
    this.question = question;
    this.previousQuestionsAnswersContext = previousQuestionsAnswersContext;
    this.assignmentInstrctions = assignmentInstrctions;
    this.learnerChoices = learnerChoices;
    this.validChoices = validChoices;
    this.totalPoints = totalPoints;
    this.scoringCriteriaType = scoringCriteriaType;
    this.scoringCriteria = scoringCriteria;
  }

  evaluatePoints(): number {
    let pointsEarned = 0;
    let penaltyPoints = 0;

    const totalCorrectChoices = this.validChoices.filter(
      (c) => c.correct
    ).length;
    const penaltyPerIncorrect =
      totalCorrectChoices > 0
        ? this.totalPoints / (4 * totalCorrectChoices)
        : 0;

    for (const learnerChoice of this.learnerChoices) {
      const matchingChoice = this.validChoices.find(
        (c) => c.choice === learnerChoice
      );

      if (matchingChoice) {
        if (matchingChoice.correct) {
          pointsEarned += matchingChoice.points;
        } else {
          penaltyPoints += penaltyPerIncorrect;
        }
      }
    }

    let totalScore = pointsEarned - penaltyPoints;
    totalScore = totalScore < 0 ? 0 : totalScore; // Ensure no negative score

    return totalScore;
  }
}
