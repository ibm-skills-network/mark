import { ApiProperty } from "@nestjs/swagger";
import { JsonValue } from "@prisma/client/runtime/library";

export class GetQuestionResponseAttemptResponseDto {
  @ApiProperty({ description: "Unique identifier for the question response." })
  id: number;

  @ApiProperty({
    description:
      "The Id of the assignment attempt that includes this response.",
  })
  assignmentAttemptId: number;

  @ApiProperty({
    description: "The Id of the question to which the student is responding.",
  })
  questionId: number;

  @ApiProperty({ description: "The student's response to the question." })
  learnerResponse: string;

  @ApiProperty({
    description: "The points earned by the student for this response.",
  })
  points: number;

  @ApiProperty({
    description: "Feedback on the student's response, stored as JSON",
  })
  feedback: JsonValue;
}
