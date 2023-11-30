import {
  BaseQuestionEvaluateModel,
  QuestionAnswerContext,
} from "./base.question.evaluate.model";

export class ChoiceBasedQuestionEvaluateModel
  implements BaseQuestionEvaluateModel
{
  readonly question: string;
  readonly validChoices: Record<string, boolean>;
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
    validChoices: Record<string, boolean>,
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
    // Count the number of valid choices
    const totalValidChoices = Object.values(this.validChoices).filter(
      Boolean
    ).length;

    // Calculate points per valid choice
    const pointsPerChoice = this.totalPoints / totalValidChoices;

    let pointsEarned = 0;

    for (const choice of this.learnerChoices) {
      // If the learner's choice is correct, increment the score count proportionally
      if (this.validChoices[choice]) {
        pointsEarned += pointsPerChoice;
      }
    }

    // Return the total points earned, rounded to avoid floating point errors
    return Math.round(pointsEarned);
  }
}
