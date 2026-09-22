import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class BaseAssignmentAttemptResponseDto {
  @ApiProperty({
    description: "The unique Id of the AssignmentAttempt",
    type: Number,
    required: true,
    example: 1,
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

  @ApiPropertyOptional({
    description:
      "The server's clock at the moment this response was produced (ISO-8601 UTC). Clients reconcile their own clock against it before counting down a timed attempt.",
    type: String,
    example: "2026-09-12T21:04:34.089Z",
  })
  serverNow?: string;
}
