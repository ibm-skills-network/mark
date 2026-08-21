import {
  IsArray,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export enum UploadType {
  AUTHOR = "author",
  LEARNER = "learner",
  LEARNER_PROD = "learner-prod",
  DEBUG = "debug",
  CHATBOT = "chatbot",
}

export class UploadContextDto {
  @IsOptional()
  @IsString()
  path?: string;

  @IsOptional()
  @IsNumber()
  assignmentId?: number;

  @IsOptional()
  @IsNumber()
  questionId?: number;

  @IsOptional()
  @IsNumber()
  reportId?: number;
}

export class UploadRequestDto {
  @IsString()
  fileName: string;

  @IsString()
  fileType: string;

  @IsNumber()
  @IsPositive()
  fileSize: number;

  @IsEnum(UploadType)
  uploadType: UploadType;

  @IsOptional()
  context?: UploadContextDto;
}

export class DirectUploadDto {
  @IsEnum(UploadType)
  uploadType: UploadType;

  /** JSON-encoded UploadContextDto. Parsed and validated in the handler. */
  @IsOptional()
  @IsString()
  context?: string;

  /**
   * Why this route was taken, for observability only. Never used to make an
   * authorization or routing decision, and constrained to a fixed set so a
   * hostile client cannot write arbitrary text into logs.
   */
  @IsOptional()
  @IsIn(["direct", "fallback"])
  source?: "direct" | "fallback";
}

export class UploadResponseDto {
  presignedUrl: string;
  key: string;
  bucket: string;
  fileType: string;
  fileName: string;
  uploadType: string;
  expiresInSeconds: number;
  expiresAt: string;
  maxAllowedBytes: number;
}

export class MultipartUploadPartUrlDto {
  @IsNumber()
  @IsPositive()
  partNumber: number;

  @IsString()
  url: string;
}

export class MultipartUploadInitiateResponseDto {
  @IsString()
  uploadId: string;

  @IsString()
  key: string;

  @IsString()
  bucket: string;

  @IsString()
  fileType: string;

  @IsString()
  fileName: string;

  @IsString()
  uploadType: string;

  @IsNumber()
  @IsPositive()
  expiresInSeconds: number;

  @IsString()
  expiresAt: string;

  @IsNumber()
  @IsPositive()
  maxAllowedBytes: number;

  @IsNumber()
  @IsPositive()
  partSizeBytes: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MultipartUploadPartUrlDto)
  urls: MultipartUploadPartUrlDto[];
}

export class CompleteMultipartUploadPartDto {
  @IsNumber()
  @IsPositive()
  partNumber: number;

  @IsString()
  etag: string;
}

export class CompleteMultipartUploadRequestDto {
  @IsString()
  uploadId: string;

  @IsString()
  key: string;

  @IsEnum(UploadType)
  uploadType: UploadType;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompleteMultipartUploadPartDto)
  parts: CompleteMultipartUploadPartDto[];
}

export class CompleteMultipartUploadResponseDto {
  success: boolean;
  key: string;
  bucket: string;
  uploadId: string;
  etag?: string;
}

export class AbortMultipartUploadRequestDto {
  @IsString()
  uploadId: string;

  @IsString()
  key: string;

  @IsEnum(UploadType)
  uploadType: UploadType;
}
