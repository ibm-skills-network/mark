import { FileHighlighting } from "./highlighting.model";

export type RubricScore = {
  rubricQuestion?: string;
  pointsAwarded?: number;
  maxPoints?: number;
  justification?: string;
  criterionSelected?: string;
  evidence?: string[];
  status?: "full" | "partial" | "none" | "unknown";
  manualReviewRequired?: boolean;
};

export class FileBasedQuestionResponseModel {
  readonly points: number;
  readonly feedback: string;
  readonly analysis?: string;
  readonly evaluation?: string;
  readonly explanation?: string;
  readonly guidance?: string;
  readonly rubricScores?: RubricScore[];
  readonly highlighting?: FileHighlighting;
  readonly annotatedPdfUrl?: string;
  readonly metadata?: Record<string, any>;

  constructor(
    points: number,
    feedback: string,
    analysis?: string,
    evaluation?: string,
    explanation?: string,
    guidance?: string,
    rubricScores?: RubricScore[],
    highlighting?: FileHighlighting,
    annotatedPdfUrl?: string,
    metadata?: Record<string, any>,
  ) {
    this.points = points;
    this.feedback = feedback;
    this.analysis = analysis;
    this.evaluation = evaluation;
    this.explanation = explanation;
    this.guidance = guidance;
    this.rubricScores = rubricScores;
    this.highlighting = highlighting;
    this.annotatedPdfUrl = annotatedPdfUrl;
    this.metadata = metadata;
  }
}
