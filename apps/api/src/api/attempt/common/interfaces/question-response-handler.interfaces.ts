import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { QuestionAnswerContext } from "../../../llm/model/base.question.evaluate.model";

/**
 * Interface for question response handlers
 */
export interface IQuestionResponseHandler {
  /**
   * Handle a response for a specific question type
   * @param question The question
   * @param requestDto The request data
   * @param assignmentContext Context for grading (optional)
   * @param assignmentId Assignment ID (optional)
   * @param language Language code (optional)
   */
  handleResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    assignmentContext?: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    },
    assignmentId?: number,
    language?: string,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: any;
  }>;
}
