import { RubricScore } from "./file.based.question.response.model";

export interface GradingMetadata {
  judgeApproved: boolean;
  judgeUsed?: boolean;
  thresholdReason?: string;
  attempts: number;
  gradingTimeMs: number;
  contentHash: string;
}

export class TextBasedQuestionResponseModel {
  public readonly points: number;
  public readonly feedback: string;
  public readonly analysis?: string;
  public readonly evaluation?: string;
  public readonly explanation?: string;
  public readonly guidance?: string;
  public readonly rubricScores?: RubricScore[];
  public readonly gradingRationale?: string;
  public readonly metadata?: GradingMetadata;

  constructor(
    points: number,
    feedback: string,
    analysis?: string,
    evaluation?: string,
    explanation?: string,
    guidance?: string,
    rubricScores?: RubricScore[],
    gradingRationale?: string,
    metadata?: GradingMetadata,
  ) {
    this.points = points;
    this.feedback = feedback;
    this.analysis = analysis;
    this.evaluation = evaluation;
    this.explanation = explanation;
    this.guidance = guidance;
    this.rubricScores = rubricScores;
    this.gradingRationale = gradingRationale;
    this.metadata = metadata;
  }

  /**
   * Create a simplified response with just the essential fields
   */
  static createSimple(
    points: number,
    feedback: string,
    explanation?: string,
    guidance?: string,
    metadata?: GradingMetadata,
  ): TextBasedQuestionResponseModel {
    return new TextBasedQuestionResponseModel(
      points,
      feedback,
      undefined,
      undefined,
      explanation,
      guidance,
      undefined,
      undefined,
      metadata,
    );
  }

  /**
   * Get percentage score
   */
  getPercentage(maxPoints: number): number {
    return maxPoints > 0 ? Math.round((this.points / maxPoints) * 100) : 0;
  }
}
