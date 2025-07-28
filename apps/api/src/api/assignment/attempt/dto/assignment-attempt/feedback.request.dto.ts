import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  IsEmail,
} from "class-validator";

export class AssignmentFeedbackDto {
  @IsOptional()
  @IsString()
  comments?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  aiGradingRating?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  assignmentRating?: number;

  @IsOptional()
  @IsBoolean()
  allowContact?: boolean;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
export class RequestRegradingResponseDto {
  success: boolean;
  id: number;
}
export class AssignmentFeedbackResponseDto {
  success: boolean;
  id: number;
}
export class RegradingRequestDto {
  @IsNumber()
  assignmentId: number;

  @IsString()
  userId: string;

  @IsNumber()
  attemptId: number;

  @IsString()
  reason: string;
}
export class RegradingStatusResponseDto {
  status: string;
}
