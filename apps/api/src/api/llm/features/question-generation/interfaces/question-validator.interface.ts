import { EnhancedQuestionsToGenerate } from "src/api/assignment/dto/post.assignment.request.dto";
import { ValidationResult } from "../services/question-validator.service";
import { DifficultyLevel } from "../services/question-generation.service";

/**
 * Interface for the question validator service
 */
export interface IQuestionValidatorService {
  /**
   * Validate a batch of generated questions against requirements
   */
  validateQuestions(
    assignmentId: number,
    questions: any[],
    requirements: EnhancedQuestionsToGenerate,
    difficultyLevel: DifficultyLevel,
    content?: string,
    learningObjectives?: string,
  ): Promise<ValidationResult>;
}
