/**
 * Model representing the response to an image-based question evaluation
 */
export interface ImageBasedQuestionResponseModel {
  /**
   * Points awarded based on the criteria
   */
  points: number;

  /**
   * Detailed feedback for the learner based on their image submission
   */
  feedback: string;

  /**
   * Optional breakdown of feedback by specific aspects of the image
   */
  aspectFeedback?: {
    /**
     * The specific aspect being evaluated
     */
    aspect: string;

    /**
     * Points awarded for this aspect
     */
    score: number;

    /**
     * Maximum possible points for this aspect
     */
    maxPoints: number;

    /**
     * Feedback specific to this aspect
     */
    feedback: string;
  }[];

  /**
   * Optional technical analysis of various image aspects
   */
  technicalAnalysis?: {
    /**
     * Feedback on composition elements (framing, rule of thirds, etc.)
     */
    composition?: string;

    /**
     * Feedback on lighting quality and usage
     */
    lighting?: string;

    /**
     * Feedback on focus quality and depth of field
     */
    focus?: string;

    /**
     * Feedback on color usage, harmony, and balance
     */
    color?: string;

    /**
     * Feedback on creative aspects and originality
     */
    creativity?: string;

    /**
     * Feedback on how well the image addresses the assignment
     */
    relevance?: string;
  };
}
