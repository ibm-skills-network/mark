import { ApiProperty } from "@nestjs/swagger";
import { Question } from "@prisma/client";
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from "class-validator";
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
  @IsNotEmpty()
  @IsBoolean()
  success: boolean;

  @ApiProperty({
    description: "Optional error message.",
    type: String,
    required: false,
  })
  @IsOptional()
  @IsString()
  error?: string;
}
