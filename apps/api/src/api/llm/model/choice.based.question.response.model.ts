export class ChoiceBasedFeedback {
  choice: string;
  feedback: string;
}

export class ChoiceBasedQuestionResponseModel {
  readonly points: number;
  readonly feedback: ChoiceBasedFeedback[];

  constructor(points: number, feedback: ChoiceBasedFeedback[]) {
    this.points = points;
    this.feedback = feedback;
  }
}
