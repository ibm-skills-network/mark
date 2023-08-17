import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class BaseResponseDto {
  @ApiProperty({
    description: "The success status of the operation performed.",
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
