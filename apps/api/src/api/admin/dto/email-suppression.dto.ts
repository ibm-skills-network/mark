import { Type } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export const ADMIN_SUPPRESSION_REASONS = [
  "HARD_BOUNCE",
  "COMPLAINT",
  "MANUAL",
] as const;

/** Body for suppressing an address, e.g. from a bounce or complaint notice. */
export class CreateEmailSuppressionDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsIn(ADMIN_SUPPRESSION_REASONS)
  reason!: (typeof ADMIN_SUPPRESSION_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListEmailSuppressionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(254)
  search?: string;
}
