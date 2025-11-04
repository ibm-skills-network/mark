import { TransformConfig } from "./data-transformer";

/**
 * Centralized transform configuration for encoding and decoding data.
 * This ensures consistency across the application and provides a single source of truth.
 */

/**
 * Fields that should be base64 encoded/decoded for API transmission and storage
 */
export const TRANSFORM_FIELDS = [
  "introduction",
  "instructions",
  "gradingCriteriaOverview",

  "question",
  "content",

  "choices.choice",
  "choices.feedback",
  "questions.choices.choice",
  "questions.choices.feedback",

  "questions.scoring.rubrics.rubricQuestion",
  "questions.scoring.rubrics.criteria.description",

  "learnerTextResponse",
  "learnerChoices",

  "questionVersions.choices.choice",
  "questionVersions.choices.feedback",
  "questionVersions.scoring.rubrics.rubricQuestion",
  "questionVersions.scoring.rubrics.criteria.description",
  "questionVersions.question",
] as const;

/**
 * Default configuration for API encoding (frontend -> backend)
 */
export const API_ENCODE_CONFIG: TransformConfig = {
  fields: [...TRANSFORM_FIELDS],
  deep: true,
};

/**
 * Default configuration for API decoding (backend -> frontend)
 */
export const API_DECODE_CONFIG: TransformConfig = {
  fields: [...TRANSFORM_FIELDS],
  deep: true,
};

/**
 * Configuration for database encoding/decoding (used by backend)
 */
export const DATABASE_CONFIG: TransformConfig = {
  fields: [...TRANSFORM_FIELDS],
  deep: true,
};

/**
 * Configuration for form data (lighter encoding)
 */
export const FORM_DATA_CONFIG: TransformConfig = {
  exclude: ["id", "createdAt", "updatedAt"],
  deep: false,
};

/**
 * Configuration for storage (heavier compression)
 */
export const STORAGE_CONFIG: TransformConfig = {
  compressionLevel: "heavy",
  deep: true,
};
