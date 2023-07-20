import { AssignmentDisplayOrder, AssignmentType } from "@prisma/client";
import { IsEnum, IsInt, IsOptional, IsString } from "class-validator";

export class CreateUpdateAssignmentRequestDto {
  @IsOptional()
  @IsString()
  name: string | null;

  @IsOptional()
  @IsEnum(AssignmentType)
  type: AssignmentType | null;

  @IsOptional()
  @IsInt()
  numRetries: number | null;

  @IsOptional()
  @IsInt()
  numAttempts: number | null;

  @IsOptional()
  @IsInt()
  allotedTime: number | null;

  @IsOptional()
  @IsInt()
  passingGrade: number | null;

  @IsOptional()
  @IsEnum(AssignmentDisplayOrder)
  displayOrder: AssignmentDisplayOrder | null;
}
