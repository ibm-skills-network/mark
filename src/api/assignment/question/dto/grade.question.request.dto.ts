import { IsNotEmpty, IsString } from "class-validator";

export class GradeQuestionRequestDto {
  @IsNotEmpty()
  @IsString()
  learnerResponse: string;
}
