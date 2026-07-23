import { ApiProperty, getSchemaPath } from "@nestjs/swagger";
import { IsString } from "class-validator";

export interface StructuredCriterion {
  name: string;
  pointsAwarded: number;
  maxPoints: number;
  status: "full" | "partial" | "none";
  evidence: string;
  feedback: string;
  nextStep?: string;
}

export interface StructuredFeedback {
  summary: string;
  criteria: StructuredCriterion[];
  guidance: string;
}

export class GeneralFeedbackDto {
  @ApiProperty({
    description: "The feedback earned by the leanrer.",
    type: String,
    required: true,
  })
  feedback: string;

  @ApiProperty({
    description: "Structured feedback data for modern UI rendering",
    type: Object,
    required: false,
  })
  structuredFeedback?: StructuredFeedback;

  @ApiProperty({
    description: "Highlighting data for visual feedback on learner responses",
    type: Object,
    required: false,
  })
  highlighting?: any;

  @ApiProperty({
    description: "URL to download annotated PDF with AI feedback overlays",
    type: String,
    required: false,
  })
  annotatedPdfUrl?: string;
}

export class ChoiceBasedFeedbackDto {
  @ApiProperty({
    description: "The choice selected by the learner.",
    type: String,
    required: true,
  })
  choice: string;

  @ApiProperty({
    description: "The feedback for selecting the above choice.",
    type: String,
    required: true,
  })
  feedback: string;
}

export class TrueFalseBasedFeedbackDto {
  @ApiProperty({
    description: "The choice selected by the learner (true or false).",
    type: Boolean,
    required: true,
  })
  choice: boolean;

  @ApiProperty({
    description: "The feedback for selecting the above choice.",
    type: String,
    required: true,
  })
  feedback: string;
}

export class CreateQuestionResponseAttemptResponseDto {
  @ApiProperty({
    description: "The unqiue id of the question response.",
    type: Number,
    required: true,
  })
  id: number;

  @ApiProperty({
    description: "The metadata for the question response.",
    type: Object,
    required: false,
  })
  metadata?: Record<string, any>;

  @ApiProperty({
    description: "The total points earned.",
    type: Number,
    required: false,
  })
  totalPoints?: number;

  points?: number;

  @ApiProperty({
    description:
      "The feedback received after evaluating the question response of the learner.",
    required: false,
    type: "array",
    items: {
      oneOf: [
        { $ref: getSchemaPath(ChoiceBasedFeedbackDto) },
        { $ref: getSchemaPath(GeneralFeedbackDto) },
        { $ref: getSchemaPath(TrueFalseBasedFeedbackDto) },
      ],
    },
  })
  feedback?:
    | ChoiceBasedFeedbackDto[]
    | GeneralFeedbackDto[]
    | TrueFalseBasedFeedbackDto[];

  @ApiProperty({
    description: "The question text.",
    type: String,
    required: true,
  })
  @IsString()
  question: string;

  @ApiProperty({
    description: "The question id.",
    type: Number,
    required: true,
  })
  questionId: number;
}
