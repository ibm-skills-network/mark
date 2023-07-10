import { AssignmentDisplayOrder, AssignmentType } from "@prisma/client";
import { IsEnum, IsInt, IsNotEmpty, IsString } from "class-validator";

// enum ExerciseType {
//   TEXT = 'TEXT',
//   MULTIPLE_CHOICE = 'MULTIPLE_CHOICE',
//   TRUE_FALSE = 'TRUE_FALSE',
//   URL = 'URL',
//   UPLOAD = 'UPLOAD',
// }

// enum ScoringCriteriaType {
//   POINTS_BASED = 'POINTS_BASED',
//   AI = 'AI',
//   LOSS_PER_MISTAKE = 'LOSS_PER_MISTAKE',
// }

export class CreateAssignmentRequestDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsEnum(AssignmentType)
  type: AssignmentType;

  @IsNotEmpty()
  @IsInt()
  numRetries: number;

  @IsNotEmpty()
  @IsInt()
  numAttempts: number;

  @IsNotEmpty()
  @IsString()
  allotedTime: string;

  @IsNotEmpty()
  @IsInt()
  passingGrade: number;

  @IsNotEmpty()
  @IsEnum(AssignmentDisplayOrder)
  displayOrder: AssignmentDisplayOrder;
}
