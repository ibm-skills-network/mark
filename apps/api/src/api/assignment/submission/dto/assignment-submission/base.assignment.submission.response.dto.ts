import { ApiProperty } from "@nestjs/swagger";

export class BaseAssignmentSubmissionResponseDto {
  @ApiProperty({
    description: "The unique ID of the AssignmentSubmission",
    example: 1,
  })
  id: number;
}
