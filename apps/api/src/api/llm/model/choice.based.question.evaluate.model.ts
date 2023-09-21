export class ChoiceBasedQuestionEvaluateModel {
  readonly question: string;
  readonly validChoices: Record<string, boolean>;
  readonly learnerChoices: string[];
  readonly totalPoints: number;
  readonly scoringCriteriaType?: string;
  readonly scoringCriteria?: object;

  constructor(
    question: string,
    validChoices: Record<string, boolean>,
    learnerChoices: string[],
    totalPoints: number,
    scoringCriteriaType?: string,
    scoringCriteria?: object
  ) {
    this.question = question;
    this.learnerChoices = learnerChoices;
    this.validChoices = validChoices;
    this.totalPoints = totalPoints;
    this.scoringCriteriaType = scoringCriteriaType;
    this.scoringCriteria = scoringCriteria;
  }
}
