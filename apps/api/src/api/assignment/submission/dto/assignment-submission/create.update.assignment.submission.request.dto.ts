import { ApiProperty } from "@nestjs/swagger";
import { Equals, IsBoolean, IsDefined } from "class-validator";

export class LearnerUpdateAssignmentSubmissionRequestDto {
  @ApiProperty({
    description: "Represents if the learner has submitted this or not",
    type: Boolean,
    example: true,
  })
  @IsBoolean()
  @IsDefined()
  @Equals(true, { message: "submitted must be true" })
  submitted: boolean;
}
