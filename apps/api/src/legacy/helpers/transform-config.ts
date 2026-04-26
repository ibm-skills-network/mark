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
 * Default configuration for database encoding/decoding
 */
export const DATABASE_CONFIG: TransformConfig = {
  fields: [...TRANSFORM_FIELDS],
  deep: true,
};

/**
 * Configuration for API encoding/decoding (used when backend acts as pass-through)
 */
export const API_CONFIG: TransformConfig = {
  fields: [...TRANSFORM_FIELDS],
  exclude: ["id", "createdAt", "updatedAt"],
  deep: true,
};
