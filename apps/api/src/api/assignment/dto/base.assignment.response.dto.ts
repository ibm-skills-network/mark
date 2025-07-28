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

  @ApiPropertyOptional({ description: "Optional error message.", type: String })
  error?: string;
}
export class UpdateAssignmentQuestionsResponseDto extends BaseAssignmentResponseDto {
  @ApiPropertyOptional({
    description: "Array of questions for the assignment",
    type: [Object],
  })
  questions?: object[];
}
