export class FileBasedQuestionResponseModel {
  readonly points: number;
  readonly feedback: string;

  constructor(points: number, feedback: string) {
    this.points = points;
    this.feedback = feedback;
  }
}
