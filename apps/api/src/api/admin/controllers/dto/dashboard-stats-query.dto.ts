import { IsOptional, IsString, IsUUID } from "class-validator";

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
  @IsUUID("4")
  userId?: string;
}
