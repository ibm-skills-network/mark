import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { CreateUpdateQuestionRequestDto } from "./create.update.question.request.dto";

export class GetQuestionResponseDto extends CreateUpdateQuestionRequestDto {
  @ApiProperty({
    description: "The Id of the question.",
    type: Number,
    required: true,
  })
  id: number;

  @ApiProperty({
    description: "The Id of the assignment it belongs to.",
    type: Number,
    required: true,
  })
  assignmentId: number;

  @ApiProperty({
    description: "The success status of the request.",
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
