import { Question } from "@prisma/client";
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { CreateUpdateAssignmentRequestDto } from "./create.update.assignment.request.dto";

export class GetAssignmentResponseDto extends CreateUpdateAssignmentRequestDto {
  questions: Question[];

  @IsNotEmpty()
  @IsBoolean()
  success: boolean;

  @IsOptional()
  @IsString()
  error?: string;
}
