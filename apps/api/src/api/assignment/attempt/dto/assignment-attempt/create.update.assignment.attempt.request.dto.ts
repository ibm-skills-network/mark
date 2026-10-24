import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  ValidateNested,
  ValidationOptions,
} from "class-validator";
import { MAX_LEARNER_URL_LENGTH } from "src/api/attempt/common/utils/learner-url.util";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import type { LearnerFileUploadWithImages } from "../question-response/create.question.response.attempt.request.dto";
import type { LearnerPresentationResponse } from "./types";

export const MAX_SUBMITTED_RESPONSES = 200;
export const MAX_LEARNER_TEXT_RESPONSE_LENGTH = 200_000;
export const MAX_LEARNER_CHOICES = 50;
export const MAX_LEARNER_CHOICE_LENGTH = 5000;
export const MAX_LEARNER_FILES = 20;
export const MAX_LEARNER_FILENAME_LENGTH = 255;
const MAX_FILE_KEY_LENGTH = 1024;
const MAX_FILE_BUCKET_LENGTH = 255;
const MAX_FILE_TYPE_LENGTH = 255;
const MAX_FILE_CONTENT_MARKER_LENGTH = 255;
const MAX_QUESTION_ID = 2_147_483_647;

/** The only keys a submitted file reference may carry. */
const LEARNER_FILE_REFERENCE_KEYS = new Set([
  "filename",
  "key",
  "bucket",
  "fileType",
  "content",
]);

const isBoundedString = (
  value: unknown,
  maxLength: number,
  allowEmpty: boolean,
): value is string =>
  typeof value === "string" &&
  value.length <= maxLength &&
  (allowEmpty || value.trim().length > 0);

/**
 * Whether a value is a list of uploaded-file references: at most
 * MAX_LEARNER_FILES plain objects, each carrying a filename and the storage
 * coordinates of the upload and nothing else. Unknown keys are refused rather
 * than stripped, so an inline-content or repository-link payload never reaches
 * grading.
 */
export const isLearnerFileReferenceList = (value: unknown): boolean => {
  if (!Array.isArray(value) || value.length > MAX_LEARNER_FILES) {
    return false;
  }
  return value.every((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((k) => !LEARNER_FILE_REFERENCE_KEYS.has(k))) {
      return false;
    }
    return (
      isBoundedString(record.filename, MAX_LEARNER_FILENAME_LENGTH, false) &&
      isBoundedString(record.key, MAX_FILE_KEY_LENGTH, false) &&
      isBoundedString(record.bucket, MAX_FILE_BUCKET_LENGTH, false) &&
      (record.fileType === undefined ||
        record.fileType === null ||
        isBoundedString(record.fileType, MAX_FILE_TYPE_LENGTH, true)) &&
      (record.content === undefined ||
        record.content === null ||
        isBoundedString(record.content, MAX_FILE_CONTENT_MARKER_LENGTH, true))
    );
  });
};

function IsLearnerFileReferenceList(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "isLearnerFileReferenceList",
      target: object.constructor,
      propertyName,
      options: {
        message:
          "learnerFileResponse must be a list of uploaded file references",
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown) => isLearnerFileReferenceList(value),
      },
    });
  };
}

/**
 * One answer in a submit. The web client sends an entry for every question,
 * answered or not, with "" / null / [] in the fields it did not fill, so every
 * field accepts its empty value. Keys not declared here are stripped by the
 * global whitelist.
 */
export class SubmittedQuestionResponseDto {
  @ApiProperty({ description: "The id of the question.", type: Number })
  @IsInt()
  @Min(1)
  @Max(MAX_QUESTION_ID)
  id: number;

  @ApiPropertyOptional({
    type: String,
    maxLength: MAX_LEARNER_TEXT_RESPONSE_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LEARNER_TEXT_RESPONSE_LENGTH)
  learnerTextResponse: string;

  @ApiPropertyOptional({ type: String, maxLength: MAX_LEARNER_URL_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LEARNER_URL_LENGTH)
  learnerUrlResponse: string;

  @ApiPropertyOptional({
    description: "Texts of the selected choices.",
    type: [String],
    maxItems: MAX_LEARNER_CHOICES,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LEARNER_CHOICES)
  @IsString({ each: true })
  @MaxLength(MAX_LEARNER_CHOICE_LENGTH, { each: true })
  learnerChoices: string[];

  @ApiPropertyOptional({ type: Boolean, nullable: true })
  @IsOptional()
  @IsBoolean()
  learnerAnswerChoice: boolean | null;

  @ApiPropertyOptional({
    description:
      "Uploaded files: {filename, key, bucket, fileType?, content?} only.",
    type: [Object],
    maxItems: MAX_LEARNER_FILES,
  })
  @IsOptional()
  @IsLearnerFileReferenceList()
  learnerFileResponse?: LearnerFileUploadWithImages[];

  @ApiPropertyOptional({
    description: "Not accepted; must be absent or null.",
    nullable: true,
  })
  @IsOptional()
  @Equals(null, { message: "learnerPresentationResponse is not supported" })
  learnerPresentationResponse: LearnerPresentationResponse | null;

  /** Set by the server from the submit's language; never read from the item. */
  language: string;
}

export type QuestionResponse = SubmittedQuestionResponseDto;

export class authorAssignmentDetailsDTO {
  @IsEnum(["ONE_PER_PAGE", "ALL_PER_PAGE"])
  questionDisplay: "ONE_PER_PAGE" | "ALL_PER_PAGE";
  @IsBoolean()
  graded: boolean;
  @IsInt()
  @IsOptional()
  numAttempts: number | null;
  @IsInt()
  passingGrade: number;
  @IsInt()
  @IsOptional()
  allotedTimeMinutes?: number;
  @IsEnum(["DEFINED", "RANDOM"])
  displayOrder: "DEFINED" | "RANDOM";
  @IsBoolean()
  strictTimeLimit: boolean;
  @IsString()
  introduction: string;
  @IsString()
  instructions: string;
  // The unsaved author toggle, so a preview can reflect it before publish.
  @IsBoolean()
  @IsOptional()
  showPassFailIndicator?: boolean;
}

export class LearnerUpdateAssignmentAttemptRequestDto {
  @ApiProperty({
    description: "Represents if the learner has submitted this or not",
    type: Boolean,
    example: true,
  })
  @IsBoolean()
  @IsDefined()
  @Equals(true, { message: "submitted must be true" })
  submitted: boolean;

  @ApiProperty({
    description: "The list of question responses for the assignment attempt",
    isArray: true,
    required: true,
  })
  @IsArray()
  @IsDefined()
  @ArrayMaxSize(MAX_SUBMITTED_RESPONSES)
  @ValidateNested({ each: true })
  @Type(() => SubmittedQuestionResponseDto)
  responsesForQuestions: SubmittedQuestionResponseDto[];
  @ApiProperty({
    description: "questions from author",
    required: false,
  })
  @IsString()
  @IsOptional()
  @ApiProperty({
    description: "The language the user prefers",
    required: false,
  })
  language?: string;
  @IsArray()
  @IsOptional()
  authorQuestions?: QuestionDto[];
  @ApiProperty({
    description: "assignment details from author",
    required: false,
  })
  @ValidateNested()
  @Type(() => authorAssignmentDetailsDTO)
  @IsOptional()
  authorAssignmentDetails?: authorAssignmentDetailsDTO;

  @ApiProperty({
    description: "Pre-translated questions",
    required: false,
  })
  @IsArray()
  @IsOptional()
  preTranslatedQuestions?: Map<number, QuestionDto>;

  @ApiProperty({
    description: "The expiration date of the assignment attempt",
    type: Date,
    required: false,
  })
  @IsOptional()
  expiresAt?: Date;
}
