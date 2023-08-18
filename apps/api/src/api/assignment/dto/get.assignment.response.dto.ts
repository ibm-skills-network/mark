import { ApiProperty, OmitType } from "@nestjs/swagger";
import { Question } from "@prisma/client";
import { CreateUpdateAssignmentRequestDto } from "./create.update.assignment.request.dto";

export class GetAssignmentResponseDto extends CreateUpdateAssignmentRequestDto {
  @ApiProperty({
    description: "The list of questions in the assignment.",
    isArray: true,
  })
  questions: Question[];

  @ApiProperty({
    description: "Indicates if the operation was successful.",
    type: Boolean,
    required: true,
  })
  success: boolean;

  @ApiProperty({
    description: "Optional error message.",
    type: String,
    required: false,
  })
  error?: string;
}

export class LearnerGetAssignmentResponseDto extends OmitType(
  GetAssignmentResponseDto,
  ["questions", "displayOrder"] as const
) {}
