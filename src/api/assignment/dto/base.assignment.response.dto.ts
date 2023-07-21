import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from "class-validator";

export class BaseAssignmentResponseDto {
  @ApiProperty({
    description: "The ID of the assignment.",
    type: Number,
    required: true,
  })
  @IsNotEmpty()
  @IsInt()
  id: number;

  @ApiProperty({
    description: "Indicates if the operation was successful.",
    type: Boolean,
    required: true,
  })
  @IsNotEmpty()
  @IsBoolean()
  success: boolean;

  @ApiPropertyOptional({ description: "Optional error message.", type: String })
  @IsOptional()
  @IsString()
  error?: string;
}
