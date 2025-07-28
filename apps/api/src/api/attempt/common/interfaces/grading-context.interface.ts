import { QuestionAnswerContext } from "src/api/llm/model/base.question.evaluate.model";

/**
 * Context data needed for grading a question response
 */
export interface GradingContext {
  /**
   * Instructions for the entire assignment
   */
  assignmentInstructions: string;

  /**
   * Context from other questions and answers
   */
  questionAnswerContext: QuestionAnswerContext[];

  /**
   * ID of the assignment
   */
  assignmentId?: number;

  /**
   * Language code for localization
   */
  language?: string;

  /**
   * Optional user role
   */
  userRole?: string;

  /**
   * Optional metadata for grading
   */
  metadata?: Record<string, any>;
}
