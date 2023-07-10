import { IsBoolean, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { CreateAssignmentRequestDto } from "./create.assignment.request.dto";

export class GetAssignmentResponseDto extends CreateAssignmentRequestDto {
  @IsNotEmpty()
  @IsBoolean()
  success: boolean;
  @IsOptional()
  @IsString()
  error?: string;
}
