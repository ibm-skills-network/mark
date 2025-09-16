import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class BaseAssignmentResponseDto {
  @ApiProperty({
    description: "The Id of the assignment.",
    type: Number,
    required: true,
  })
  id: number;

  @ApiProperty({
    description: "Indicates if the operation was successful.",
    type: Boolean,
    required: true,
  })
  success: boolean;

  @ApiProperty({
    description: "The name of the assignment.",
    type: String,
    required: true,
  })
  name: string;

  @ApiProperty({
    description: "The type of the assignment.",
    type: String,
    required: true,
  })
  type: string;

  @ApiPropertyOptional({ description: "Optional error message.", type: String })
  error?: string;
  @ApiProperty({
    description: "The number of unique users associated with the assignment.",
    type: Number,
    required: true,
  })
  uniqueUsers?: number;
}
