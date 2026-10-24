import { Type } from "class-transformer";
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { LearnerUpdateAssignmentAttemptRequestDto } from "../api/assignment/attempt/dto/assignment-attempt/create.update.assignment.attempt.request.dto";

/** Largest id a Postgres `integer` column holds. */
export const MAX_INTERNAL_ID = 2_147_483_647;
export const MAX_INTERNAL_USER_ID_LENGTH = 320;
export const MAX_INTERNAL_AUTH_COOKIE_LENGTH = 16_384;

export const QUEUED_GRADING_TIERS = ["standard", "heavy"] as const;
export type QueuedGradingTier = (typeof QUEUED_GRADING_TIERS)[number];

/**
 * A learner submit already accepted by the caller (ownership, deadline,
 * served ids and payload checks done), to be graded by the worker. The
 * `updateDto` text fields arrive decoded; nothing here is base64.
 */
export class InternalGradingEnqueueRequestDto {
  @IsInt()
  @Min(1)
  @Max(MAX_INTERNAL_ID)
  assignmentId: number;

  @IsInt()
  @Min(1)
  @Max(MAX_INTERNAL_ID)
  attemptId: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_INTERNAL_USER_ID_LENGTH)
  userId: string;

  @IsBoolean()
  gradingCallbackRequired: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_INTERNAL_AUTH_COOKIE_LENGTH)
  authCookie?: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  submissionReceivedAt: string;

  @IsIn(QUEUED_GRADING_TIERS)
  tier: QueuedGradingTier;

  @IsDefined()
  @ValidateNested()
  @Type(() => LearnerUpdateAssignmentAttemptRequestDto)
  updateDto: LearnerUpdateAssignmentAttemptRequestDto;
}

export class InternalGradingActiveJobQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_INTERNAL_USER_ID_LENGTH)
  userId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INTERNAL_ID)
  assignmentId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_INTERNAL_ID)
  attemptId: number;
}

export interface InternalGradingEnqueueResponse {
  gradingJobId: string;
  reused: boolean;
  message: string;
}

export interface InternalGradingActiveJobResponse {
  gradingJobId: string | null;
}
