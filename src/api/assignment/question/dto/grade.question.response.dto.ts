import { IsInt, IsNotEmpty, IsString } from "class-validator";

export class GradeQuestionResponseDto {
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
