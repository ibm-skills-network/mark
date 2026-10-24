import {
  BadRequestException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  authorUploadKeyPrefix,
  isWellFormedStorageKey,
} from "../../../files/services/storage-key";

export const INVALID_FILE_REFERENCE_CODE = "INVALID_FILE_REFERENCE";
export const INVALID_FILE_REFERENCE_MESSAGE = "Invalid file reference.";

export const UNSUPPORTED_RESPONSE_TYPE_CODE = "UNSUPPORTED_RESPONSE_TYPE";
export const UNSUPPORTED_RESPONSE_TYPE_MESSAGE =
  "This question type is no longer supported.";

/**
 * 400 for a submitted file that is not the learner's own upload for that
 * question. Deliberately generic: it never says which part did not match.
 */
export class InvalidLearnerFileReferenceException extends BadRequestException {
  constructor() {
    super({
      statusCode: 400,
      code: INVALID_FILE_REFERENCE_CODE,
      message: INVALID_FILE_REFERENCE_MESSAGE,
      error: "Bad Request",
    });
  }
}

/** 400 for an answer to a question whose response type is no longer graded. */
export class UnsupportedResponseTypeException extends BadRequestException {
  constructor() {
    super({
      statusCode: 400,
      code: UNSUPPORTED_RESPONSE_TYPE_CODE,
      message: UNSUPPORTED_RESPONSE_TYPE_MESSAGE,
      error: "Bad Request",
    });
  }
}

export const NO_GRADABLE_QUESTIONS_CODE = "NO_GRADABLE_QUESTIONS";
export const NO_GRADABLE_QUESTIONS_MESSAGE =
  "This assignment has no questions that can be graded.";

/**
 * 422 for a submit whose served questions are all of response types that are
 * no longer graded: nothing could be scored, so nothing is written or sent.
 */
export class NoGradableQuestionsException extends UnprocessableEntityException {
  constructor() {
    super({
      statusCode: 422,
      code: NO_GRADABLE_QUESTIONS_CODE,
      message: NO_GRADABLE_QUESTIONS_MESSAGE,
      error: "Unprocessable Entity",
    });
  }
}

export type LearnerFileReferenceDenial =
  | "missing_storage_reference"
  | "bucket_not_allowed"
  | "malformed_key"
  | "key_outside_learner_prefix";

export interface LearnerFileReferenceScope {
  assignmentId: number;
  userId: string;
  questionId: number;
  allowedBuckets: ReadonlySet<string>;
}

/** The storage prefix every learner upload for one question is written under. */
export const learnerUploadKeyPrefix = (
  scope: Pick<
    LearnerFileReferenceScope,
    "assignmentId" | "userId" | "questionId"
  >,
): string => `${scope.assignmentId}/${scope.userId}/${scope.questionId}/`;

/**
 * Why the first file in `files` is not under `prefix` in one of
 * `allowedBuckets`, or null when every file is. Keys with empty, `.` or `..`
 * segments, backslashes or control characters are refused outright.
 */
const findFileReferenceDenial = (
  files: ReadonlyArray<{ bucket?: unknown; key?: unknown }>,
  prefix: string,
  allowedBuckets: ReadonlySet<string>,
): LearnerFileReferenceDenial | null => {
  for (const file of files) {
    if (
      typeof file?.bucket !== "string" ||
      typeof file?.key !== "string" ||
      file.bucket.length === 0 ||
      file.key.length === 0
    ) {
      return "missing_storage_reference";
    }
    if (!allowedBuckets.has(file.bucket)) {
      return "bucket_not_allowed";
    }
    if (!isWellFormedStorageKey(file.key)) {
      return "malformed_key";
    }
    if (!file.key.startsWith(prefix) || file.key.length === prefix.length) {
      return "key_outside_learner_prefix";
    }
  }
  return null;
};

/**
 * Why the first file in `files` is not the learner's own upload for this
 * question, or null when every file is. A file must name one of the learner
 * upload buckets and a key under `<assignmentId>/<userId>/<questionId>/`,
 * which is where the upload routes write it.
 */
export const findLearnerFileReferenceDenial = (
  files: ReadonlyArray<{ bucket?: unknown; key?: unknown }>,
  scope: LearnerFileReferenceScope,
): LearnerFileReferenceDenial | null => {
  if (!scope.userId) {
    return "key_outside_learner_prefix";
  }
  return findFileReferenceDenial(
    files,
    learnerUploadKeyPrefix(scope),
    scope.allowedBuckets,
  );
};

export interface AuthorFileReferenceScope {
  userId: string;
  allowedBuckets: ReadonlySet<string>;
}

/**
 * The author-preview counterpart: every file must name one of the author
 * upload buckets and a key under the author's own `authors/<userId>/`.
 */
export const findAuthorFileReferenceDenial = (
  files: ReadonlyArray<{ bucket?: unknown; key?: unknown }>,
  scope: AuthorFileReferenceScope,
): LearnerFileReferenceDenial | null => {
  if (!scope.userId) {
    return "key_outside_learner_prefix";
  }
  return findFileReferenceDenial(
    files,
    authorUploadKeyPrefix(scope.userId),
    scope.allowedBuckets,
  );
};
