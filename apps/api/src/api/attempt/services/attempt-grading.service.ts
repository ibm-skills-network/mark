import { Injectable } from "@nestjs/common";
import { Assignment } from "@prisma/client";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";

@Injectable()
export class AttemptGradingService {
  /**
   * Calculates the grade based on question responses and assignment settings if the role is author.
   * @param successfulQuestionResponses Array of successful question responses
   * @param authorQuestions Array of author questions
   * @returns Object containing grade, total points earned, and total possible points
   */
  calculateGradeForAuthor(
    successfulQuestionResponses: CreateQuestionResponseAttemptResponseDto[],
    totalPossiblePoints: number,
  ): { grade: number; totalPointsEarned: number } {
    if (successfulQuestionResponses.length === 0) {
      return { grade: 0, totalPointsEarned: 0 };
    }

    const totalPointsEarned = this.calculateTotalPointsEarned(
      successfulQuestionResponses,
    );
    const grade =
      totalPossiblePoints > 0 ? totalPointsEarned / totalPossiblePoints : 0;

    return { grade, totalPointsEarned };
  }

  /**
   * Calculates the grade based on question responses and assignment settings if the role is learner.
   * @param successfulQuestionResponses Array of successful question responses
   * @param assignment The assignment object
   * @returns Object containing grade, total points earned, and total possible points
   */
  calculateGradeForLearner(
    successfulQuestionResponses: CreateQuestionResponseAttemptResponseDto[],
    totalPossiblePoints: number,
  ): { grade: number; totalPointsEarned: number; totalPossiblePoints: number } {
    if (successfulQuestionResponses.length === 0) {
      return { grade: 0, totalPointsEarned: 0, totalPossiblePoints: 0 };
    }
    const totalPointsEarned = this.calculateTotalPointsEarned(
      successfulQuestionResponses,
    );
    const grade =
      totalPossiblePoints > 0 ? totalPointsEarned / totalPossiblePoints : 0;

    return { grade, totalPointsEarned, totalPossiblePoints };
  }

  /**
   * Constructs feedbacks for questions based on the assignment settings.
   * @param successfulQuestionResponses The successful question responses
   * @param assignment The assignment object
   * @returns An array of feedbacks for questions
   */
  constructFeedbacksForQuestions(
    successfulQuestionResponses: CreateQuestionResponseAttemptResponseDto[],
    assignment: Assignment,
  ) {
    return successfulQuestionResponses.map((feedbackForQuestion) => {
      const { totalPoints, feedback, ...otherData } = feedbackForQuestion;
      return {
        totalPoints: assignment.showQuestionScore ? totalPoints : -1,
        feedback: assignment.showSubmissionFeedback ? feedback : undefined,
        ...otherData,
      };
    });
  }

  /**
   * Calculates total points earned from successful question responses.
   * @param responses Array of question responses
   * @returns Total points earned
   */
  private calculateTotalPointsEarned(
    responses: CreateQuestionResponseAttemptResponseDto[],
  ): number {
    return responses.reduce(
      (accumulator, response) => accumulator + response.totalPoints,
      0,
    );
  }
}
