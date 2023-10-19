export class UrlBasedQuestionEvaluateModel {
  readonly question: string;
  readonly urlProvided: string;
  readonly isUrlFunctional: boolean;
  readonly urlBody: string;
  readonly totalPoints: number;
  readonly scoringCriteriaType: string;
  readonly scoringCriteria: object;

  constructor(
    question: string,
    urlProvided: string,
    isUrlFunctional: boolean,
    urlBody: string,
    totalPoints: number,
    scoringCriteriaType: string,
    scoringCriteria: object
  ) {
    this.question = question;
    this.urlProvided = urlProvided;
    this.isUrlFunctional = isUrlFunctional;
    this.urlBody = urlBody;
    this.totalPoints = totalPoints;
    this.scoringCriteriaType = scoringCriteriaType;
    this.scoringCriteria = scoringCriteria;
  }
}
