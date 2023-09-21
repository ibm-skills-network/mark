export class TrueFalseBasedQuestionEvaluateModel {
  readonly question: string;
  readonly answer: boolean;
  readonly learnerChoice: boolean;
  readonly totalPoints: number;

  constructor(
    question: string,
    answer: boolean,
    learnerChoice: boolean,
    totalPoints: number
  ) {
    this.question = question;
    this.answer = answer;
    this.learnerChoice = learnerChoice;
    this.totalPoints = totalPoints;
  }
}
