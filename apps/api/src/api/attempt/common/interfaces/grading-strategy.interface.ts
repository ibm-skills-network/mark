import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { GradingContext } from "./grading-context.interface";

/**
 * Interface for all grading strategy implementations.
 * Each question type should have its own implementation.
 */
export interface IGradingStrategy<T = any> {
  /**
   * Validates the response based on question type requirements
   * @param question The question data
   * @param requestDto The request containing the user's response
   * @returns True if valid, throws BadRequestException otherwise
   */
  validateResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<boolean>;

  /**
   * Extracts the learner's response from the request DTO
   * @param requestDto The request containing the user's response
   * @returns The extracted response in the appropriate format for this question type
   */
  extractLearnerResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<T>;

  /**
   * Grades the response against the question criteria
   * @param question The question data
   * @param learnerResponse The learner's validated response
   * @param context Additional context for grading
   * @returns The grading response DTO with score and feedback
   */
  gradeResponse(
    question: QuestionDto,
    learnerResponse: T,
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto>;
}
