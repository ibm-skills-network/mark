import { ApiProperty } from "@nestjs/swagger";

export class CreateUpdateAnswerSubmissionRequestDto {
  @ApiProperty({
    description: "The ID of the assignment that this submission corresponds to",
    example: 2,
  })
  assignmentId: number;

  @ApiProperty({
    description: "Represents if the learner has submitted this or not",
    type: Boolean,
    example: false,
  })
  submitted: boolean;
}
