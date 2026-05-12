import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsPositive,
  IsString,
  ValidateNested,
} from "class-validator";

export const ALLOWED_ASSIGNMENT_FILE_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/x-ipynb+json",
] as const;

export class InitiateAssignmentFileItemDto {
  @ApiProperty({ description: "Original file name" })
  @IsString()
  fileName: string;

  @ApiProperty({ description: "MIME type of the file" })
  @IsString()
  @IsIn(ALLOWED_ASSIGNMENT_FILE_MIME_TYPES, {
    message: "Unsupported mimeType for assignment file upload",
  })
  mimeType: string;

  @ApiProperty({ description: "File size in bytes" })
  @IsNumber()
  @IsPositive()
  fileSize: number;
}

export class InitiateAssignmentFilesDto {
  @ApiProperty({
    type: [InitiateAssignmentFileItemDto],
    description: "Files to initiate (1 to 10 per request)",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => InitiateAssignmentFileItemDto)
  files: InitiateAssignmentFileItemDto[];
}

export class AssignmentFilePartUrlDto {
  @ApiProperty()
  partNumber: number;

  @ApiProperty()
  url: string;
}

export class InitiateAssignmentFileItemResponseDto {
  @ApiProperty()
  fileId: number;

  @ApiProperty()
  uploadId: string;

  @ApiProperty()
  key: string;

  @ApiProperty()
  bucket: string;

  @ApiProperty()
  partSizeBytes: number;

  @ApiProperty({ type: [AssignmentFilePartUrlDto] })
  urls: AssignmentFilePartUrlDto[];
}

export class InitiateAssignmentFilesResponseDto {
  @ApiProperty({ type: [InitiateAssignmentFileItemResponseDto] })
  uploads: InitiateAssignmentFileItemResponseDto[];
}

export class AssignmentFilePartDto {
  @ApiProperty()
  @IsNumber()
  @IsPositive()
  partNumber: number;

  @ApiProperty()
  @IsString()
  etag: string;
}

export class CompleteAssignmentFileDto {
  @ApiProperty({ description: "S3 multipart upload ID returned from initiate" })
  @IsString()
  uploadId: string;

  @ApiProperty({
    type: [AssignmentFilePartDto],
    description: "Parts uploaded to S3 (partNumber + ETag per part)",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AssignmentFilePartDto)
  parts: AssignmentFilePartDto[];
}
