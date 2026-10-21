/**
 * Upper bound on file content rebuilt from a parsed JSON value. Notebooks
 * learners submit run to about 1.4 MB; anything far past this is not a
 * notebook worth grading and only costs memory to carry through grading.
 */
export const MAX_COERCED_FILE_CONTENT_LENGTH = 20_000_000;

export class LearnerFileContentTooLargeError extends Error {
  constructor(readonly length: number) {
    super("Learner file content is too large to process");
    this.name = "LearnerFileContentTooLargeError";
  }
}

export type LearnerFileContentType =
  | "string"
  | "undefined"
  | "null"
  | "object"
  | "array"
  | "number"
  | "boolean"
  | "other";

export interface NormalizedLearnerFileContent {
  content: string | undefined;
  originalType: LearnerFileContentType;
}

function contentTypeOf(value: unknown): LearnerFileContentType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
    case "undefined":
    case "object":
    case "number":
    case "boolean": {
      return typeof value as LearnerFileContentType;
    }
    default: {
      return "other";
    }
  }
}

/**
 * File content is text everywhere downstream. A JSON file's text (a notebook,
 * a .json upload) can reach the server already parsed into an object, by the
 * request decoder or a client that sends it that way; serializing it again
 * recovers the file's JSON text, so the learner is graded on what they sent.
 */
export function normalizeLearnerFileContent(
  value: unknown,
): NormalizedLearnerFileContent {
  const originalType = contentTypeOf(value);
  switch (originalType) {
    case "string": {
      return { content: value as string, originalType };
    }
    case "undefined":
    case "null": {
      return { content: undefined, originalType };
    }
    case "object":
    case "array": {
      const serialized = JSON.stringify(value);
      if (serialized.length > MAX_COERCED_FILE_CONTENT_LENGTH) {
        throw new LearnerFileContentTooLargeError(serialized.length);
      }
      return { content: serialized, originalType };
    }
    case "number":
    case "boolean": {
      return { content: String(value as number | boolean), originalType };
    }
    default: {
      return { content: undefined, originalType };
    }
  }
}
