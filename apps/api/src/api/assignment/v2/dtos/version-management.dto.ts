import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
} from "class-validator";

export class CreateVersionDto {
  @ApiPropertyOptional({
    description: "Semantic version number (e.g., '1.0.0' or '1.0.0-rc1')",
  })
  @IsOptional()
  @IsString()
  versionNumber?: string;

  @ApiPropertyOptional({
    description: "Description of what changed in this version",
  })
  @IsOptional()
  @IsString()
  versionDescription?: string;

  @ApiPropertyOptional({
    description: "Whether this version should be created as a draft",
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isDraft?: boolean;

  @ApiPropertyOptional({
    description: "Whether this version should be activated immediately",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  shouldActivate?: boolean;

  @ApiPropertyOptional({
    description: "Whether to update existing version if it already exists",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  updateExisting?: boolean;
}

export class CompareVersionsDto {
  @ApiProperty({ description: "Version ID to compare from" })
  @IsNumber()
  fromVersionId: number;

  @ApiProperty({ description: "Version ID to compare to" })
  @IsNumber()
  toVersionId: number;
}

export class RestoreVersionDto {
  @ApiProperty({ description: "Version ID to restore" })
  @IsNumber()
  versionId: number;

  @ApiPropertyOptional({
    description: "Create as new version instead of activating existing",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  createAsNewVersion?: boolean;

  @ApiPropertyOptional({ description: "Description for the restored version" })
  @IsOptional()
  @IsString()
  versionDescription?: string;
}

export class SaveDraftDto {
  @ApiProperty({ description: "Partial assignment data to save" })
  assignmentData: Record<string, any>;

  @ApiPropertyOptional({ description: "Questions data to save" })
  @IsOptional()
  @IsArray()
  questionsData?: Array<any>;

  @ApiPropertyOptional({
    description: "Semantic version number (e.g., '1.0.0' or '1.0.0-rc1')",
  })
  @IsOptional()
  @IsString()
  versionNumber?: string;

  @ApiPropertyOptional({ description: "Description for this draft save" })
  @IsOptional()
  @IsString()
  versionDescription?: string;
}

export class VersionSummary {
  @ApiProperty({ description: "Unique version ID" })
  id: number;

  @ApiProperty({
    description: "Semantic version number (e.g., '1.0.0' or '1.0.0-rc1')",
  })
  versionNumber: string;

  @ApiPropertyOptional({
    description: "Description of changes in this version",
  })
  versionDescription?: string;

  @ApiProperty({ description: "Whether this version is a draft" })
  isDraft: boolean;

  @ApiProperty({ description: "Whether this version is currently active" })
  isActive: boolean;

  @ApiProperty({ description: "Whether this version is published" })
  published: boolean;

  @ApiProperty({ description: "User ID who created this version" })
  createdBy: string;

  @ApiProperty({ description: "When this version was created" })
  createdAt: Date;

  @ApiProperty({ description: "Number of questions in this version" })
  questionCount: number;
}

export class VersionChangeDto {
  @ApiProperty({ description: "Field that changed" })
  field: string;

  @ApiPropertyOptional({ description: "Value in the from version" })
  fromValue: any;

  @ApiPropertyOptional({ description: "Value in the to version" })
  toValue: any;

  @ApiProperty({
    description: "Type of change",
    enum: ["added", "modified", "removed"],
  })
  changeType: "added" | "modified" | "removed";
}

export class QuestionChangeDto {
  @ApiPropertyOptional({ description: "Original question ID if applicable" })
  questionId?: number;

  @ApiProperty({ description: "Display order of the question" })
  displayOrder: number;

  @ApiProperty({
    description: "Type of change",
    enum: ["added", "modified", "removed"],
  })
  changeType: "added" | "modified" | "removed";

  @ApiPropertyOptional({
    description: "Field that changed within the question",
  })
  field?: string;

  @ApiPropertyOptional({ description: "Value in the from version" })
  fromValue?: any;

  @ApiPropertyOptional({ description: "Value in the to version" })
  toValue?: any;
}

export class VersionComparison {
  @ApiProperty({ description: "Summary of the version being compared from" })
  fromVersion: VersionSummary;

  @ApiProperty({ description: "Summary of the version being compared to" })
  toVersion: VersionSummary;

  @ApiProperty({
    description: "Changes in assignment-level fields",
    type: [VersionChangeDto],
  })
  assignmentChanges: VersionChangeDto[];

  @ApiProperty({
    description: "Changes in questions",
    type: [QuestionChangeDto],
  })
  questionChanges: QuestionChangeDto[];
}

export class AutoSaveDto {
  @ApiProperty({ description: "Partial assignment data to auto-save" })
  assignmentData: Record<string, any>;

  @ApiPropertyOptional({ description: "Questions data to auto-save" })
  @IsOptional()
  @IsArray()
  questionsData?: Array<any>;
}

export class UpdateVersionDescriptionDto {
  @ApiProperty({ description: "Updated description for the version" })
  @IsString()
  versionDescription: string;
}

export class UpdateVersionNumberDto {
  @ApiProperty({ description: "Updated version number" })
  @IsString()
  versionNumber: string;
}

export class VersionExistsResponse {
  @ApiProperty({ description: "Whether the version already exists" })
  versionExists: boolean;

  @ApiProperty({ description: "The existing version details" })
  existingVersion: VersionSummary;

  @ApiProperty({ description: "Message about the conflict" })
  message: string;
}
