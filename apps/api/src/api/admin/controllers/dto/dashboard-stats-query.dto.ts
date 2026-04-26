import { IsEmail, IsOptional, IsString, MaxLength } from "class-validator";

export class DashboardStatsQueryDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  assignmentId?: string;

  @IsOptional()
  @IsString()
  assignmentName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  userId?: string;
}
