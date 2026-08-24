import {
  IsDateString,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

export class DashboardStatsQueryDto {
  @IsOptional()
  @IsString()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsString()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d*$/, {
    message: "assignmentId must be a positive integer",
  })
  assignmentId?: string;

  @IsOptional()
  @IsString()
  assignmentName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  userId?: string;
}
