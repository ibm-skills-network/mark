import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CorrectAnswerVisibility, Prisma } from "@prisma/client";

/** A choice as a learner sees it; the answer key fields only after submission. */
export class LearnerChoiceDto {
  @ApiProperty({ type: Number, nullable: true }) id: number | null;
  @ApiProperty({ type: String }) choice: string;
  @ApiPropertyOptional({ type: Boolean }) isCorrect?: boolean;
  @ApiPropertyOptional({ type: String, nullable: true })
  feedback?: string | null;
}

export class LearnerQuestionTranslationDto {
  @ApiProperty({ type: String }) translatedText: string;
  @ApiProperty({ type: [LearnerChoiceDto], nullable: true })
  translatedChoices: LearnerChoiceDto[] | null;
}

export class LearnerAttemptQuestionDto {
  @ApiProperty({ type: Number }) id: number;
  @ApiProperty({ type: String }) question: string;
  @ApiProperty({ type: String }) type: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  responseType?: string | null;
  @ApiProperty({ type: [LearnerChoiceDto] }) choices: LearnerChoiceDto[];
  @ApiProperty({ type: Object })
  translations: Record<string, LearnerQuestionTranslationDto>;
  @ApiProperty({ type: Object, nullable: true }) authorComment: null;
  @ApiPropertyOptional({ type: Number }) maxWords?: number;
  @ApiPropertyOptional({ type: Number }) maxCharacters?: number;
  @ApiPropertyOptional({ type: Object }) scoring?: Record<string, unknown>;
  @ApiProperty({ type: Number }) totalPoints: number;
  @ApiProperty({ type: Number }) assignmentId: number;
  @ApiProperty({ type: [Number] }) gradingContextQuestionIds: number[];
  @ApiProperty({ type: Boolean }) isDeleted: boolean;
  @ApiProperty({ type: [LearnerChoiceDto], nullable: true })
  randomizedChoices: LearnerChoiceDto[] | null;
  @ApiPropertyOptional({ type: Object, nullable: true })
  videoPresentationConfig?: Prisma.JsonValue | null;
  @ApiPropertyOptional({ type: Object, nullable: true })
  liveRecordingConfig?: Prisma.JsonValue | null;
}

export class LearnerQuestionResponseDto {
  @ApiProperty({ type: Number }) id: number;
  @ApiProperty({ type: Number }) assignmentAttemptId: number;
  @ApiProperty({ type: Number }) questionId: number;
  @ApiProperty({ type: String }) learnerResponse: string;
  @ApiProperty({ type: Number, nullable: true }) points: number | null;
  @ApiProperty({ type: Object }) feedback: Prisma.JsonValue;
  @ApiProperty({ type: Object, nullable: true }) metadata: Prisma.JsonValue;
  @ApiProperty({ type: Date, nullable: true }) gradedAt: Date | null;
}

export class LearnerAttemptVersionDto {
  @ApiProperty({ type: Number }) id: number;
  @ApiProperty({ type: Number, nullable: true })
  allotedTimeMinutes: number | null;
}

/** One row of the attempts list. */
export class AttemptSummaryResponseDto {
  @ApiProperty({ type: Number }) id: number;
  @ApiProperty({ type: Number }) assignmentId: number;
  @ApiProperty({ type: Number, nullable: true })
  assignmentVersionId: number | null;
  @ApiProperty({ type: String }) userId: string;
  @ApiProperty({ type: Boolean }) submitted: boolean;
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      "Null when unsubmitted or when the assignment hides its score.",
  })
  grade: number | null;
  @ApiProperty({ type: Date, nullable: true }) expiresAt: Date | null;
  @ApiProperty({ type: Date }) createdAt: Date;
  @ApiProperty({ type: [Number] }) questionOrder: number[];
  @ApiProperty({ type: String, nullable: true }) comments: string | null;
  @ApiProperty({ type: String, nullable: true })
  preferredLanguage: string | null;
}

/** An in-progress or submitted attempt with its questions, for rendering. */
export class LearnerAttemptResponseDto extends AttemptSummaryResponseDto {
  @ApiProperty({ type: String }) serverNow: string;
  @ApiProperty({ type: [LearnerAttemptQuestionDto] })
  questions: LearnerAttemptQuestionDto[];
  @ApiProperty({ type: [LearnerQuestionResponseDto] })
  questionResponses: LearnerQuestionResponseDto[];
  @ApiProperty({ type: Number }) passingGrade: number;
  @ApiProperty({ type: Boolean }) showAssignmentScore: boolean;
  @ApiProperty({ type: Boolean }) showSubmissionFeedback: boolean;
  @ApiProperty({ type: Boolean }) showQuestionScore: boolean;
  @ApiProperty({ type: Boolean }) showQuestions: boolean;
  @ApiProperty({ enum: CorrectAnswerVisibility })
  correctAnswerVisibility: CorrectAnswerVisibility;
  @ApiProperty({ type: Number, nullable: true })
  currentVersionId: number | null;
  @ApiProperty({ type: Boolean }) versionMismatch: boolean;
  @ApiProperty({ type: LearnerAttemptVersionDto, nullable: true })
  assignmentVersion: LearnerAttemptVersionDto | null;
}
