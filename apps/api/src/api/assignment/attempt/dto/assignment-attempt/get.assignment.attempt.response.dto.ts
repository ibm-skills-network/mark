import { Optional } from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  CorrectAnswerVisibility,
  QuestionResponse,
  QuestionType,
  ResponseType,
} from "@prisma/client";
import { Type } from "class-transformer";
import { AttemptQuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { Choice } from "../../../question/dto/create.update.question.request.dto";
import { IsOptional, IsString } from "class-validator";

export class AssignmentAttemptResponseDto {
  @ApiProperty({
    description: "The unique Id of the AssignmentAttempt",
    type: Number,
    example: 1,
    required: true,
  })
  id: number;

  @ApiProperty({
    description: "The Id of the assignment that this attempt corresponds to",
    type: Number,
    example: 2,
    required: true,
  })
  assignmentId: number;

  @ApiProperty({
    description: "Represents if the learner has submitted this or not",
    type: Boolean,
    example: false,
  })
  submitted: boolean;

  @ApiProperty({
    description:
      "The overall LTI grade value (from 0.0 - 1.0) that the learner earned for this attempt",
    type: Number,
    example: 0.8,
    required: false,
  })
  grade: number | null;

  @ApiProperty({
    description:
      "The DateTime at which the attempt window ends (can no longer submit it)",
    type: Date,
    example: "2023-12-31T23:59:59Z",
    required: false,
  })
  expiresAt: Date | null;

  @ApiProperty({
    description: "The DateTime at which the attempt was created",
    type: Date,
    example: "2023-12-31T10:00:00Z",
    required: true,
  })
  createdAt: Date;
}

export class GetAssignmentAttemptResponseDto extends AssignmentAttemptResponseDto {
  @ApiProperty({
    description:
      "The list of questions for the assignment that this attempt corresponds to with learner's responses",
    isArray: true,
  })
  questions: AttemptQuestionDto[] | AssignmentAttemptQuestions[];
  @ApiProperty({
    description: "Passing grade for the assignment",
    type: Number,
    required: true,
  })
  passingGrade: number;
  @ApiProperty({
    description: "Show submission feedback",
    type: Boolean,
    required: false,
  })
  showSubmissionFeedback: boolean;
  @ApiProperty({
    description: "Show question",
    type: Boolean,
    required: false,
  })
  showQuestions: boolean;
  @ApiProperty({
    description: "Show assignment score",
    type: Boolean,
    required: false,
  })
  showAssignmentScore: boolean;
  @ApiProperty({
    description: "Show question score",
    type: Boolean,
    required: false,
  })
  showQuestionScore: boolean;

  @ApiProperty({
    description: "Show correct answer",
    type: Boolean,
    required: false,
  })
  correctAnswerVisibility: CorrectAnswerVisibility;

  @ApiPropertyOptional({
    description: "The comments for the question.",
    type: String,
    required: false,
  })
  @Optional()
  comments?: string;

  @ApiPropertyOptional({
    description: "Question-level controls (copy, paste, right-click, print)",
    type: "object",
    required: false,
  })
  @Optional()
  questionControls?: {
    disableCopy?: boolean;
    disablePaste?: boolean;
    disableRightClick?: boolean;
    disablePrint?: boolean;
  };

  @ApiPropertyOptional({
    description:
      "Sum of totalPoints across all questions, computed before any visibility filtering. Frontend uses this to render the score line when showQuestions=false strips the questions array.",
    type: Number,
    required: false,
  })
  @Optional()
  totalPossiblePoints?: number;

  @ApiPropertyOptional({
    description:
      "Sum of points earned across all question responses, computed before any visibility filtering. Omitted when showAssignmentScore=false.",
    type: Number,
    required: false,
  })
  @Optional()
  totalPointsEarned?: number;

  @ApiPropertyOptional({
    description:
      "The version of the assignment this attempt was created against. Null for attempts created before versioning was wired in.",
    type: Number,
    nullable: true,
    required: false,
  })
  @Optional()
  assignmentVersionId?: number | null;

  @ApiPropertyOptional({
    description:
      "The assignment's current active version. Compare against assignmentVersionId to detect drift.",
    type: Number,
    nullable: true,
    required: false,
  })
  @Optional()
  currentVersionId?: number | null;

  @ApiPropertyOptional({
    description:
      "True when this attempt is pinned to a stale version (the assignment has been republished since the attempt began). Frontend can use this to prompt the learner to start a fresh attempt.",
    type: Boolean,
    required: false,
  })
  @Optional()
  versionMismatch?: boolean;
}

export class AssignmentAttemptQuestions {
  @ApiProperty({
    description: "The Id of the question.",
    type: Number,
    required: true,
  })
  id: number;

  @ApiProperty({
    description: "Total points for the question.",
    type: Number,
    required: true,
  })
  totalPoints: number;

  @ApiPropertyOptional({
    description: "Author comment or note on this question",
    type: String,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  authorComment?: string | null;

  @ApiProperty({
    description: "Type of the question.",
    enum: QuestionType,
    required: true,
  })
  type: QuestionType;

  @ApiProperty({
    description: "The question content.",
    type: String,
    required: true,
  })
  question: string;

  @ApiPropertyOptional({
    description:
      'The choices for the question (if the Question Type is "SINGLE_CORRECT" or "MULTIPLE_CORRECT").',
    type: [Choice],
  })
  @Type(() => Choice)
  choices?: Choice[];

  @ApiPropertyOptional({
    description: "The max number of words allowed for this question.",
    type: Number,
    required: false,
  })
  maxWords?: number;

  @ApiPropertyOptional({
    description: "The max number of characters allowed for this question.",
    type: Number,
    required: false,
  })
  maxCharacters?: number;

  @ApiProperty({
    description:
      "The list of responses provided by the learner for this question",
    isArray: true,
  })
  @Optional()
  questionResponses?: QuestionResponse[];

  @ApiPropertyOptional({
    description: "The response type for the question.",
    type: ResponseType,
    required: false,
  })
  @Optional()
  responseType?: ResponseType;
  @ApiPropertyOptional({
    description: "The variant id for the question.",
    type: Number,
    required: false,
  })
  @Optional()
  variantId?: number;

  @ApiPropertyOptional({
    description:
      "The learner's selected choices for multiple choice questions (array of choice indices as strings).",
    type: [String],
    required: false,
  })
  @Optional()
  learnerChoices?: string[];

  @ApiPropertyOptional({
    description:
      "Translation availability marker. Set to 'pending' when a translation is in-flight " +
      "but not yet written, 'unavailable' when no in-flight job exists and the row is absent. " +
      "Field is omitted entirely when the Translation row is present.",
    type: String,
    enum: ["pending", "unavailable"],
  })
  @IsOptional()
  @IsString()
  translationStatus?: "pending" | "unavailable";

  @Optional()
  _permutation?: boolean;
}
