import { ApiProperty } from "@nestjs/swagger";
import { BaseResponseDto } from "../base.response.dto";

export class BaseAssignmentSubmissionResponseDto extends BaseResponseDto {
  @ApiProperty({
    description: "The unique ID of the AssignmentSubmission",
    example: 1,
  })
  id: number;
}
