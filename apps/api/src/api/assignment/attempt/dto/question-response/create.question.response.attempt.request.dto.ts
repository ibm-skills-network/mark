import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import {
  LearnerFileUpload,
  RepoType,
} from "src/api/attempt/common/interfaces/attempt.interface";
import { LearnerPresentationResponse } from "../assignment-attempt/types";

export class CreateQuestionResponseAttemptRequestDto {
  @ApiPropertyOptional({
    description: "The learner's text response (for text based questions).",
    type: String,
  })
  @IsOptional()
  @IsString()
  learnerTextResponse: string;

  @ApiPropertyOptional({
    description: "The language code of the learner's response.",
    type: String,
  })
  @IsOptional()
  @IsString()
  language: string;

  @ApiPropertyOptional({
    description: "The learner's url based response (for url based questions).",
    type: String,
  })
  @IsOptional()
  learnerUrlResponse: string;

  @ApiPropertyOptional({
    description: "The learner's choices (for choice based questions).",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  learnerChoices: string[];

  @ApiPropertyOptional({
    description: "The learner's answer choice (for true false questions).",
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  learnerAnswerChoice: boolean;

  @ApiPropertyOptional({
    description: "The learner's file response.",
    type: [Object],
  })
  @IsOptional()
  learnerFileResponse?: LearnerFileUploadWithImages[];

  @ApiPropertyOptional({
    description: "The learner's presentation response.",
    type: [Object],
  })
  @IsOptional()
  learnerPresentationResponse: LearnerPresentationResponse;

  @ApiPropertyOptional({
    description: "The id of the question.",
    type: Number,
  })
  id: number;
}
export class LearnerFileUploadWithImages implements LearnerFileUpload {
  content: string;
  questionId?: number;
  fileType?: string;
  bucket?: string;
  githubUrl?: string;
  recordId?: number;
  key?: string;
  path?: string;
  repo?: RepoType;
  owner?: string;
  blob?: Blob;
  @IsString()
  filename: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsString()
  mimeType: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImageAnalysisResultDto)
  imageAnalysisResult?: ImageAnalysisResultDto;

  @IsOptional()
  @IsString()
  imageData?: string;

  @IsOptional()
  @IsString()
  imageBucket?: string;

  @IsOptional()
  @IsString()
  imageKey?: string;
}

export class LearnerImageUploadDto {
  @IsString()
  filename: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsString()
  mimeType: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ImageAnalysisResultDto)
  imageAnalysisResult?: ImageAnalysisResultDto;

  @IsOptional()
  @IsString()
  imageData?: string;

  @IsOptional()
  @IsString()
  imageBucket?: string;

  @IsOptional()
  @IsString()
  imageKey?: string;
}

export class ImageAnalysisResultDto {
  @IsNumber()
  width: number;

  @IsNumber()
  height: number;

  @IsNumber()
  aspectRatio: number;

  @IsNumber()
  fileSize: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dominantColors?: string[];

  @IsOptional()
  @IsNumber()
  brightness?: number;

  @IsOptional()
  @IsNumber()
  contrast?: number;

  @IsOptional()
  @IsNumber()
  sharpness?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DetectedObjectDto)
  detectedObjects?: DetectedObjectDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DetectedTextDto)
  detectedText?: DetectedTextDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TechnicalQualityDto)
  technicalQuality?: TechnicalQualityDto;

  @IsOptional()
  @IsString()
  sceneType?: string;

  @IsOptional()
  @IsString()
  rawDescription?: string;

  @IsOptional()
  additionalData?: Record<string, any>;
}

export class DetectedObjectDto {
  @IsString()
  label: string;

  @IsNumber()
  confidence: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => BoundingBoxDto)
  boundingBox?: BoundingBoxDto;
}

export class DetectedTextDto {
  @IsString()
  text: string;

  @IsNumber()
  confidence: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => BoundingBoxDto)
  boundingBox?: BoundingBoxDto;
}

export class BoundingBoxDto {
  @IsNumber()
  x: number;

  @IsNumber()
  y: number;

  @IsNumber()
  width: number;

  @IsNumber()
  height: number;
}

export class TechnicalQualityDto {
  @IsOptional()
  @IsNumber()
  exposureScore?: number;

  @IsOptional()
  @IsNumber()
  noiseLevel?: number;

  @IsOptional()
  @IsNumber()
  compositionScore?: number;
}
