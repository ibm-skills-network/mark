/**
 * The file-type maps handed to react-dropzone, in one place.
 *
 * These become the `accept` attribute on the underlying `<input type="file">`.
 * Android's document picker filters strictly by MIME type and resolves a bare
 * extension through a system map that does not know every Office extension, so
 * a wrong MIME here silently hides the learner's file: an `.xlsx` listed under
 * the `.xls` type left phone pickers offering only the image entries, which
 * reads to the learner as "I can only upload images".
 *
 * The accept list is a convenience for the picker, never a security boundary —
 * the server validates uploads independently.
 */

export type UploadAcceptMap = Record<string, string[]>;

/** Office and OpenDocument-era types, spelled the way the specs define them. */
export const DOCUMENT_ACCEPT: UploadAcceptMap = {
  "text/plain": [".txt"],
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
    ".pptx",
  ],
  "text/csv": [".csv"],
  "text/markdown": [".md"],
  "application/x-ipynb+json": [".ipynb"],
};

export const IMAGE_ACCEPT: UploadAcceptMap = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
};

export const CODE_ACCEPT: UploadAcceptMap = {
  "text/x-python": [".py"],
  "application/javascript": [".js"],
  "application/x-typescript": [".ts"],
  "application/x-tsx": [".tsx"],
  "application/x-shellscript": [".sh"],
  "text/html": [".html"],
  "text/css": [".css"],
  "application/sql": [".sql"],
  "text/markdown": [".md"],
  "application/x-ipynb+json": [".ipynb"],
};

/**
 * Upload questions keep accepting images alongside documents: when a
 * question's responseType arrives missing it falls back to the question type
 * "UPLOAD", and an image-upload question must still offer PNG/JPEG there.
 */
export const UPLOAD_ACCEPT: UploadAcceptMap = {
  ...IMAGE_ACCEPT,
  ...DOCUMENT_ACCEPT,
};

/** Author-side import/reference-file picker: documents only, no images. */
export const AUTHORING_DOCUMENT_ACCEPT: UploadAcceptMap = DOCUMENT_ACCEPT;

/**
 * Resolves the accept map for a learner upload control. `responseType` wins
 * when present; otherwise the question type decides.
 */
export function getUploadAcceptMap(
  questionType: string | null | undefined,
  responseType?: string | null,
): UploadAcceptMap {
  switch (responseType || questionType) {
    case "CODE": {
      return CODE_ACCEPT;
    }
    case "IMAGES": {
      return IMAGE_ACCEPT;
    }
    case "UPLOAD":
    case "REPORT":
    case "SPREADSHEET": {
      return UPLOAD_ACCEPT;
    }
    default: {
      return {};
    }
  }
}
