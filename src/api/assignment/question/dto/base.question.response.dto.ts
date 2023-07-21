import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from "class-validator";

export class BaseQuestionResponseDto {
  @ApiProperty({
    description: "The ID of the question.",
    type: Number,
    required: true,
  })
  @IsNotEmpty()
  @IsInt()
  id: number;

  @ApiProperty({
    description: "The success status of the question.",
    type: Boolean,
    required: true,
  })
  @IsNotEmpty()
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({
    description: "The error message, if any.",
    type: String,
  })
  @IsOptional()
  @IsString()
  error?: string;
}
