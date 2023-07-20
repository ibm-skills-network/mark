export class TextBasedQuestionEvaluateModel {
  readonly question: string;
  readonly learnerResponse: string;
  readonly totalPoints: number;
  readonly scoringCriteriaType: string;
  readonly scoringCriteria: object;

  constructor(
    question: string,
    learnerResponse: string,
    totalPoints: number,
    scoringCriteriaType: string,
    scoringCriteria: object
  ) {
    this.question = question;
    this.learnerResponse = learnerResponse;
    this.totalPoints = totalPoints;
    this.scoringCriteriaType = scoringCriteriaType;
    this.scoringCriteria = scoringCriteria;
  }
}
