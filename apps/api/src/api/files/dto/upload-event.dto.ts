import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export const UPLOAD_EVENT_PHASES = [
  "presign",
  "storage_put",
  "multipart_initiate",
  "multipart_part",
  "multipart_complete",
] as const;
export type UploadEventPhase = (typeof UPLOAD_EVENT_PHASES)[number];

/** Phases whose failure can carry a response from the storage leg. */
export const STORAGE_LEG_PHASES: ReadonlySet<UploadEventPhase> = new Set([
  "storage_put",
  "multipart_part",
]);

export const UPLOAD_EVENT_OUTCOMES = ["failed", "fallback_succeeded"] as const;
export type UploadEventOutcome = (typeof UPLOAD_EVENT_OUTCOMES)[number];

export const UPLOAD_FAILURE_KINDS = [
  "network",
  "stall",
  "cors",
  "http",
  "aborted",
  "unknown",
] as const;
export type UploadFailureKind = (typeof UPLOAD_FAILURE_KINDS)[number];

export const UPLOAD_FALLBACK_OUTCOMES = [
  "succeeded",
  "failed",
  "too_large",
] as const;
export type UploadFallbackOutcome = (typeof UPLOAD_FALLBACK_OUTCOMES)[number];

export const UPLOAD_SIZE_BUCKETS = [
  "lt_1mb",
  "1_5mb",
  "5_10mb",
  "10_50mb",
  "gt_50mb",
] as const;
export type UploadSizeBucket = (typeof UPLOAD_SIZE_BUCKETS)[number];

const MAX_DB_INT = 2_147_483_647;

/**
 * A browser's report that a learner upload failed, or only succeeded through
 * the API fallback. Every field is observational: nothing here is trusted for
 * identity or authorization (the user comes from the session), and every
 * string is bounded and shape-checked so a hostile client cannot write
 * arbitrary text into the logs.
 */
export class UploadEventDto {
  @IsIn(UPLOAD_EVENT_PHASES)
  phase: UploadEventPhase;

  @IsIn(UPLOAD_EVENT_OUTCOMES)
  outcome: UploadEventOutcome;

  /** null when no HTTP response was readable. */
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(599)
  httpStatus?: number | null;

  @IsIn(UPLOAD_FAILURE_KINDS)
  failureKind: UploadFailureKind;

  @IsBoolean()
  fallbackAttempted: boolean;

  @IsOptional()
  @IsIn(UPLOAD_FALLBACK_OUTCOMES)
  fallbackOutcome?: UploadFallbackOutcome;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(599)
  fallbackHttpStatus?: number | null;

  @IsIn(UPLOAD_SIZE_BUCKETS)
  sizeBucket: UploadSizeBucket;

  @IsOptional()
  @IsString()
  @MaxLength(111)
  @Matches(/^[\w+.-]{1,50}\/[\w+.-]{1,60}$/)
  mimeType?: string;

  /** Extension only — the file name itself is never sent. */
  @IsOptional()
  @IsString()
  @Matches(/^[\da-z]{1,10}$/i)
  fileExtension?: string;

  /** `Server` header of a readable storage-leg rejection. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[\u0020-\u007E]*$/)
  responseServer?: string;

  @IsOptional()
  @IsBoolean()
  hasAmzRequestId?: boolean;

  /** Client-scrubbed start of a readable storage-leg rejection's body. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  responseBodySnippet?: string;

  @IsBoolean()
  isWebView: boolean;

  @IsBoolean()
  isCourseraApp: boolean;

  @IsBoolean()
  inIframe: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DB_INT)
  assignmentId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DB_INT)
  questionId?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DB_INT)
  attemptId?: number;
}
