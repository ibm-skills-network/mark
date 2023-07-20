import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from "class-validator";

export class BaseQuestionResponseDto {
  @IsNotEmpty()
  @IsInt()
  id: number;
  @IsNotEmpty()
  @IsBoolean()
  success: boolean;
  @IsOptional()
  @IsString()
  error?: string;
}
