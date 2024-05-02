export class TrueFalseBasedQuestionResponseModel {
  readonly choice: boolean;
  readonly points: number;
  readonly feedback: string;

  constructor(choice: boolean, points: number, feedback: string) {
    this.choice = choice;
    this.points = points;
    this.feedback = feedback;
  }
}
