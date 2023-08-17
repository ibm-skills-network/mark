import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class BaseQuestionResponseDto {
  @ApiProperty({
    description: "The ID of the question.",
    type: Number,
    required: true,
  })
  id: number;

  @ApiProperty({
    description: "The success status of the question.",
    type: Boolean,
    required: true,
  })
  success: boolean;

  @ApiPropertyOptional({
    description: "The error message, if any.",
    type: String,
  })
  error?: string;
}
