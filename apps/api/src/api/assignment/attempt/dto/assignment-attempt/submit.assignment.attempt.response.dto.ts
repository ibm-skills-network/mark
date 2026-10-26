import { ApiProperty } from "@nestjs/swagger";
import { CorrectAnswerVisibility } from "@prisma/client";
import type { CreateQuestionResponseAttemptResponseDto } from "../question-response/create.question.response.attempt.response.dto";

export type SubmittedQuestionFeedback =
  CreateQuestionResponseAttemptResponseDto["feedback"];

/** Per-question result of a submit, already gated by the assignment settings. */
export class SubmitQuestionFeedbackDto {
  @ApiProperty({ description: "Id of the stored question response." })
  id: number;

  @ApiProperty()
  questionId: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: "Points earned; null when question scores are hidden.",
  })
  totalPoints: number | null;

  @ApiProperty({
    type: [Object],
    nullable: true,
    description: "Grading feedback; null when submission feedback is hidden.",
  })
  feedback: SubmittedQuestionFeedback | null;
}

/**
 * What a learner submit returns, inline from the PATCH or as the SSE
 * `finalize` result. Everything the assignment hides is null, never a
 * sentinel, and nothing beyond these fields is sent.
 */
export class SubmitAssignmentAttemptResponseDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: [true] })
  submitted: true;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: "0..1; null when the assignment score is hidden.",
  })
  grade: number | null;

  @ApiProperty({ type: Number, nullable: true })
  totalPointsEarned: number | null;

  @ApiProperty({ type: Number, nullable: true })
  totalPossiblePoints: number | null;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      "Whether the attempt met the passing grade; null unless the pass/fail indicator is on and the attempt has a grade.",
  })
  passed: boolean | null;

  @ApiProperty()
  showAssignmentScore: boolean;

  @ApiProperty()
  showSubmissionFeedback: boolean;

  @ApiProperty()
  showQuestions: boolean;

  @ApiProperty()
  showQuestionScore: boolean;

  @ApiProperty()
  showPassFailIndicator: boolean;

  @ApiProperty({ enum: CorrectAnswerVisibility })
  correctAnswerVisibility: CorrectAnswerVisibility;

  @ApiProperty({ type: [SubmitQuestionFeedbackDto] })
  feedbacksForQuestions: SubmitQuestionFeedbackDto[];
}
