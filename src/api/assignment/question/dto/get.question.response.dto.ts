import { IsBoolean, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { CreateUpdateQuestionRequestDto } from "./create.update.question.request.dto";

export class GetQuestionResponseDto extends CreateUpdateQuestionRequestDto {
  @IsNotEmpty()
  @IsBoolean()
  success: boolean;

  @IsOptional()
  @IsString()
  error?: string;
}
