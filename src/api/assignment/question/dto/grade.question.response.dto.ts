import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from "class-validator";

export class TextBasedFeedbackDto {
  @IsNotEmpty()
  @IsString()
  criteria: string;

  @IsNotEmpty()
  @IsInt()
  points: number;

  @IsNotEmpty()
  @IsString()
  feedback: string;
}

export class ChoiceBasedFeedbackDto {
  @IsNotEmpty()
  @IsString()
  choice: string;

  @IsNotEmpty()
  @IsString()
  feedback: string;
}

export class GradeQuestionResponseDto {
  @IsNotEmpty()
  @IsInt()
  totalPointsEarned: number;

  @IsArray()
  @ValidateNested({ each: true })
  feedback: ChoiceBasedFeedbackDto[] | TextBasedFeedbackDto[];
}
