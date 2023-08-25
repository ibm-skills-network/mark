import { ApiProperty } from "@nestjs/swagger";
import { JsonValue } from "@prisma/client/runtime/library";

export class GetQuestionResponseSubmissionResponseDto {
  @ApiProperty({ description: "Unique identifier for the question response." })
  id: number;

  @ApiProperty({
    description:
      "The ID of the assignment submission that includes this response.",
  })
  assignmentSubmissionId: number;

  @ApiProperty({
    description: "The ID of the question to which the student is responding.",
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
