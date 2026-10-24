import { ApiProperty, OmitType } from "@nestjs/swagger";
import {
  AssignmentQuestionDisplayOrder,
  AssignmentType,
  CorrectAnswerVisibility,
  Prisma,
  Question,
  QuestionDisplay,
} from "@prisma/client";
import { UpdateAssignmentRequestDto } from "./update.assignment.request.dto";

export class AssignmentResponseDto extends UpdateAssignmentRequestDto {
  @ApiProperty({
    description: "The Id of the assignment.",
    type: Number,
    required: true,
  })
  id: number;
}

export class GetAssignmentResponseDto extends AssignmentResponseDto {
  @ApiProperty({
    description: "The list of questions in the assignment.",
    isArray: true,
  })
  questions: Question[];

  @ApiProperty({
    description: "Indicates if the operation was successful.",
    type: Boolean,
    required: true,
  })
  success: boolean;

  @ApiProperty({
    description: "Optional error message.",
    type: String,
    required: false,
  })
  error?: string;

  @ApiProperty({
    description: "Indicates if the assignment is already in the backend.",
    type: String,
    required: false,
  })
  alreadyInBackend?: boolean;
}

/** The v1 learner view, which still returns the loose row shape. */
export class LegacyLearnerGetAssignmentResponseDto extends OmitType(
  GetAssignmentResponseDto,
  ["questions", "displayOrder"] as const,
) {
  questions: Question[];
  displayOrder: string;
}

/**
 * The learner view of an assignment. Explicit so nothing from the version
 * rows (answers, rubrics, author comments) can ride along.
 */
export class LearnerGetAssignmentResponseDto {
  @ApiProperty({ type: Number }) id: number;
  @ApiProperty({ type: String }) name: string;
  @ApiProperty({ type: String, nullable: true }) introduction: string | null;
  @ApiProperty({ type: String, nullable: true }) instructions: string | null;
  @ApiProperty({ type: String, nullable: true })
  gradingCriteriaOverview: string | null;
  @ApiProperty({ type: Number, nullable: true })
  timeEstimateMinutes: number | null;
  @ApiProperty({ type: Number }) attemptsBeforeCoolDown: number;
  @ApiProperty({ type: Number }) retakeAttemptCoolDownMinutes: number;
  @ApiProperty({ enum: AssignmentType }) type: AssignmentType;
  @ApiProperty({ type: Boolean }) graded: boolean;
  @ApiProperty({ type: Number, description: "-1 means unlimited." })
  numAttempts: number;
  @ApiProperty({ type: Number, nullable: true })
  allotedTimeMinutes: number | null;
  @ApiProperty({ type: Boolean }) requireAllQuestions: boolean;
  @ApiProperty({ type: Number, isArray: true }) optionalQuestionIds: number[];
  @ApiProperty({ type: Number, nullable: true })
  attemptsPerTimeRange: number | null;
  @ApiProperty({ type: Number, nullable: true })
  attemptsTimeRangeHours: number | null;
  @ApiProperty({ type: Number }) passingGrade: number;
  @ApiProperty({ enum: AssignmentQuestionDisplayOrder, nullable: true })
  displayOrder: AssignmentQuestionDisplayOrder | null;
  @ApiProperty({ enum: QuestionDisplay }) questionDisplay: QuestionDisplay;
  @ApiProperty({ type: Number, nullable: true })
  numberOfQuestionsPerAttempt: number | null;
  @ApiProperty({ type: Number, isArray: true }) questionOrder: number[];
  @ApiProperty({ type: Boolean }) published: boolean;
  @ApiProperty({ type: Boolean }) showAssignmentScore: boolean;
  @ApiProperty({ type: Boolean }) showQuestionScore: boolean;
  @ApiProperty({ type: Boolean }) showSubmissionFeedback: boolean;
  @ApiProperty({ type: Boolean }) showQuestions: boolean;
  @ApiProperty({ type: Boolean }) showPassFailIndicator: boolean;
  @ApiProperty({ enum: CorrectAnswerVisibility })
  correctAnswerVisibility: CorrectAnswerVisibility;
  @ApiProperty({ type: Object, nullable: true })
  questionControls: Prisma.JsonValue | null;
  @ApiProperty({ type: Date }) updatedAt: Date;
  @ApiProperty({ type: String, nullable: true }) languageCode: string | null;
  @ApiProperty({ type: Number, nullable: true })
  currentVersionId: number | null;
  @ApiProperty({ type: Boolean }) success: true;
}
