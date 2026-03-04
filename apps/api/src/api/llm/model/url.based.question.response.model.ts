export class UrlBasedQuestionResponseModel {
  readonly points: number;
  readonly feedback: string;
  readonly gradingRationale: string;
  readonly metadata?: Record<string, any>;
}
