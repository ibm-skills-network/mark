import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from "class-validator";

export enum UploadType {
  AUTHOR = "author",
  LEARNER = "learner",
  LEARNER_PROD = "learner-prod",
  DEBUG = "debug",
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
