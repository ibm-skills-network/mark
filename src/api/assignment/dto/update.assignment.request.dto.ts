import { AssignmentDisplayOrder, AssignmentType } from "@prisma/client";
import { IsEnum, IsInt, IsOptional, IsString } from "class-validator";

export class UpdateAssignmentRequestDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(AssignmentType)
  type?: AssignmentType;

  @IsOptional()
  @IsInt()
  numRetries?: number;

  @IsOptional()
  @IsInt()
  numAttempts?: number;

  @IsOptional()
  @IsString()
  allotedTime?: string;

  @IsOptional()
  @IsInt()
  passingGrade?: number;

  @IsOptional()
  @IsEnum(AssignmentDisplayOrder)
  displayOrder?: AssignmentDisplayOrder;
}
