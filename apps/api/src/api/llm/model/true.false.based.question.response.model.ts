export class TrueFalseChoiceBasedFeedback {
  choice: boolean;
  feedback: string;
}

export class TrueFalseBasedQuestionResponseModel {
  readonly points: number;
  readonly feedback: TrueFalseChoiceBasedFeedback[];

  constructor(points: number, feedback: TrueFalseChoiceBasedFeedback[]) {
    this.points = points;
    this.feedback = feedback;
  }
}
