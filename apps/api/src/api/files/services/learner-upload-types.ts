/**
 * File extensions a learner upload may carry, by the question's response type
 * (or its question type when the response type is unset). Mirrors
 * `getUploadAcceptMap` in apps/web/lib/upload-accept.ts: the browser's picker
 * applies the same lists, but the API is reachable without it, so the server
 * enforces them too. Keep the two in step.
 */

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

const DOCUMENT_EXTENSIONS = [
  ".txt",
  ".pdf",
  ".docx",
  ".xls",
  ".xlsx",
  ".pptx",
  ".csv",
  ".md",
  ".ipynb",
];

const CODE_EXTENSIONS = [
  ".py",
  ".js",
  ".ts",
  ".tsx",
  ".sh",
  ".html",
  ".css",
  ".sql",
  ".md",
  ".ipynb",
];

/** Allowed extensions, or undefined when the question accepts any file. */
export function learnerUploadExtensions(
  questionType: string | null | undefined,
  responseType: string | null | undefined,
): readonly string[] | undefined {
  switch (responseType || questionType) {
    case "CODE": {
      return CODE_EXTENSIONS;
    }
    case "IMAGES": {
      return IMAGE_EXTENSIONS;
    }
    case "UPLOAD":
    case "REPORT":
    case "SPREADSHEET": {
      return [...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS];
    }
    default: {
      return undefined;
    }
  }
}

/** The lowercased extension, dot included, or "" when there is none. */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}
