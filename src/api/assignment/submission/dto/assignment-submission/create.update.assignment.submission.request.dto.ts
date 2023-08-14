import { ApiProperty } from "@nestjs/swagger";
import { AssignmentSubmissionState } from "@prisma/client";
import { IsEnum } from "class-validator";

export class CreateUpdateAnswerSubmissionRequestDto {
  @ApiProperty({
    description: "The ID of the assignment that this submission corresponds to",
    example: 2,
  })
  assignmentId: number;

  @ApiProperty({
    description: "The state of the AssignmentSubmission",
    enum: AssignmentSubmissionState,
    example: AssignmentSubmissionState.IN_PROGRESS,
  })
  @IsEnum(AssignmentSubmissionState)
  state: AssignmentSubmissionState;
}
