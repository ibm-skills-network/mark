export type RubricScore = {
  rubricQuestion?: string;
  pointsAwarded?: number;
  maxPoints?: number;
  justification?: string;
  criterionSelected?: string;
};

export class FileBasedQuestionResponseModel {
  readonly points: number;
  readonly feedback: string;
  readonly analysis?: string;
  readonly evaluation?: string;
  readonly explanation?: string;
  readonly guidance?: string;
  readonly rubricScores?: RubricScore[];

  constructor(
    points: number,
    feedback: string,
    analysis?: string,
    evaluation?: string,
    explanation?: string,
    guidance?: string,
    rubricScores?: RubricScore[],
  ) {
    this.points = points;
    this.feedback = feedback;
    this.analysis = analysis;
    this.evaluation = evaluation;
    this.explanation = explanation;
    this.guidance = guidance;
    this.rubricScores = rubricScores;
  }
}
