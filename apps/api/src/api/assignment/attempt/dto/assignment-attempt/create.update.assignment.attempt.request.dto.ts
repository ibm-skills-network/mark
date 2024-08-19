import { ApiProperty } from "@nestjs/swagger";
import { Equals, IsArray, IsBoolean, IsDefined } from "class-validator";
import type { CreateQuestionResponseAttemptRequestDto } from "../question-response/create.question.response.attempt.request.dto";

type QuestionResponse = CreateQuestionResponseAttemptRequestDto & {
  id: number;
};
export class LearnerUpdateAssignmentAttemptRequestDto {
  @ApiProperty({
    description: "Represents if the learner has submitted this or not",
    type: Boolean,
    example: true,
  })
  @IsBoolean()
  @IsDefined()
  @Equals(true, { message: "submitted must be true" })
  submitted: boolean;

  @ApiProperty({
    description: "The list of question responses for the assignment attempt",
    isArray: true,
    required: true,
  })
  @IsArray()
  @IsDefined()
  responsesForQuestions: QuestionResponse[];
}
