import { ApiProperty } from "@nestjs/swagger";
import { CorrectAnswerVisibility } from "@prisma/client";
import { LearnerChoiceDto } from "./learner-attempt.response.dto";

/** The learner's newest graded response to one question. */
export class CompletedQuestionResponseDto {
  @ApiProperty({
    description:
      "The stored response as a JSON value (string, string[], boolean or file list). The raw text when it is not valid JSON.",
  })
  learnerResponse: unknown;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: "Null when the assignment hides question scores.",
  })
  points: number | null;

  @ApiProperty({
    type: [Object],
    nullable: true,
    description: "Null when the assignment hides submission feedback.",
  })
  feedback: unknown[] | null;
}

export class CompletedAttemptQuestionDto {
  @ApiProperty({ type: Number }) id: number;
  @ApiProperty({ type: String, nullable: true }) question: string | null;
  @ApiProperty({ type: String }) type: string;
  @ApiProperty({ type: String, nullable: true }) responseType: string | null;
  @ApiProperty({ type: Number }) totalPoints: number;

  @ApiProperty({
    type: [LearnerChoiceDto],
    nullable: true,
    description:
      "Null when the question has no choices. `isCorrect`/`feedback` only when correct-answer visibility allows it.",
  })
  choices: LearnerChoiceDto[] | null;

  @ApiProperty({
    type: Object,
    nullable: true,
    description: "Only when the author shows rubrics to learners.",
  })
  scoring: Record<string, unknown> | null;

  @ApiProperty({ type: CompletedQuestionResponseDto, nullable: true })
  response: CompletedQuestionResponseDto | null;
}

/** A submitted attempt as the learner's results page shows it. */
export class CompletedAttemptResponseDto {
  @ApiProperty({ type: Number }) id: number;
  @ApiProperty({ type: Number }) assignmentId: number;
  @ApiProperty({ type: Boolean, enum: [true] }) submitted: true;
  @ApiProperty({ type: Date }) createdAt: Date;
  @ApiProperty({ type: Date, nullable: true }) expiresAt: Date | null;
  @ApiProperty({ type: String, nullable: true })
  preferredLanguage: string | null;
  @ApiProperty({ type: String, nullable: true }) comments: string | null;
  @ApiProperty({ type: String }) serverNow: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: "0-1 fraction. Null when the assignment hides its score.",
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
      "Null unless the pass/fail indicator is on and a grade exists.",
  })
  passed: boolean | null;
  @ApiProperty({ type: Number }) passingGrade: number;

  @ApiProperty({ type: Boolean }) showAssignmentScore: boolean;
  @ApiProperty({ type: Boolean }) showSubmissionFeedback: boolean;
  @ApiProperty({ type: Boolean }) showQuestions: boolean;
  @ApiProperty({ type: Boolean }) showQuestionScore: boolean;
  @ApiProperty({ type: Boolean }) showPassFailIndicator: boolean;
  @ApiProperty({ enum: CorrectAnswerVisibility })
  correctAnswerVisibility: CorrectAnswerVisibility;

  @ApiProperty({
    type: [CompletedAttemptQuestionDto],
    description: "Empty when the assignment hides questions.",
  })
  questions: CompletedAttemptQuestionDto[];
}
