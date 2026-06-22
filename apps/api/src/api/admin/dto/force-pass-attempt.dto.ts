import { IsInt, IsOptional, Max, Min } from "class-validator";

/**
 * Body for the admin force-pass action.
 *
 * `gradePercent` is on the 0-100 scale (same convention the regrading-approve
 * flow uses) and is stored as a 0-1 fraction on the attempt. Omitting it means
 * "pass at 100%", the common case for a manual pass.
 */
export class ForcePassAttemptDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  gradePercent?: number;
}
