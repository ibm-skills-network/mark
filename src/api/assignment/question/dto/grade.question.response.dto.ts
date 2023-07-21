import { ApiProperty } from "@nestjs/swagger";
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from "class-validator";

export class TextBasedFeedbackDto {
  @ApiProperty({ description: "The criteria.", type: String, required: true })
  @IsNotEmpty()
  @IsString()
  criteria: string;

  @ApiProperty({ description: "The points.", type: Number, required: true })
  @IsNotEmpty()
  @IsInt()
  points: number;

  @ApiProperty({ description: "The feedback.", type: String, required: true })
  @IsNotEmpty()
  @IsString()
  feedback: string;
}

export class ChoiceBasedFeedbackDto {
  @ApiProperty({ description: "The choice.", type: String, required: true })
  @IsNotEmpty()
  @IsString()
  choice: string;

  @ApiProperty({ description: "The feedback.", type: String, required: true })
  @IsNotEmpty()
  @IsString()
  feedback: string;
}

export class GradeQuestionResponseDto {
  @ApiProperty({
    description: "The total points earned.",
    type: Number,
    required: true,
  })
  @IsNotEmpty()
  @IsInt()
  totalPointsEarned: number;

  @ApiProperty({
    description: "The feedback.",
    type: [ChoiceBasedFeedbackDto, TextBasedFeedbackDto],
    isArray: true,
    required: true,
  })
  @IsArray()
  @ValidateNested({ each: true })
  feedback: ChoiceBasedFeedbackDto[] | TextBasedFeedbackDto[];
}
