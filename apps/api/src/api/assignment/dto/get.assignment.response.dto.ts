import { ApiProperty, OmitType } from "@nestjs/swagger";
import { AssignmentVersion, Question } from "@prisma/client";
import { UpdateAssignmentRequestDto } from "./update.assignment.request.dto";

export class AssignmentResponseDto extends UpdateAssignmentRequestDto {
  @ApiProperty({
    description: "The Id of the assignment.",
    type: Number,
    required: true,
  })
  id: number;
}

export class GetAssignmentResponseDto extends AssignmentResponseDto {
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

  @ApiProperty({
    description: "Indicates if the assignment is already in the backend.",
    type: String,
    required: false,
  })
  alreadyInBackend?: boolean;
}

export class LearnerGetAssignmentResponseDto extends OmitType(
  GetAssignmentResponseDto,
  ["questions", "displayOrder"] as const,
) {
  currentVersion?: AssignmentVersion;
  questions: Question[];
  displayOrder: string;
}
