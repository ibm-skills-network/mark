/**
 * A file answer as the submit route accepts it: a reference to the learner's
 * own upload in object storage. The API grades the stored object, never
 * inline text, and refuses any other key, so `content` is only the marker
 * saying the file lives in storage.
 */
export interface SubmittedFileReference {
  filename: string;
  key: string;
  bucket: string;
  fileType?: string;
  content: "InCos";
}

const MAX_FILENAME_LENGTH = 255;
const MAX_KEY_LENGTH = 1024;
const MAX_BUCKET_LENGTH = 255;
const MAX_FILE_TYPE_LENGTH = 255;

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

/**
 * Reduces any stored file entry (a fresh upload, a server draft, or an entry
 * saved by an older client with repository fields or the file's full text) to
 * the reference the submit route accepts. Returns null for an entry that does
 * not point at an uploaded object, which the server could never grade.
 */
export function toSubmittedFileReference(
  file: unknown,
): SubmittedFileReference | null {
  if (!file || typeof file !== "object") return null;
  const entry = file as Record<string, unknown>;
  const key = nonEmptyString(entry.key);
  const bucket = nonEmptyString(entry.bucket);
  if (!key || !bucket) return null;
  if (key.length > MAX_KEY_LENGTH || bucket.length > MAX_BUCKET_LENGTH) {
    return null;
  }
  const filename = (
    nonEmptyString(entry.filename) ??
    (key.split("/").pop() || key)
  ).substring(0, MAX_FILENAME_LENGTH);
  const fileType = nonEmptyString(entry.fileType);
  return {
    filename,
    key,
    bucket,
    ...(fileType && fileType.length <= MAX_FILE_TYPE_LENGTH
      ? { fileType }
      : {}),
    content: "InCos",
  };
}

/** {@link toSubmittedFileReference} over a list, dropping unusable entries. */
export function toSubmittedFileReferences(
  files: unknown,
): SubmittedFileReference[] {
  if (!Array.isArray(files)) return [];
  return files
    .map(toSubmittedFileReference)
    .filter((file): file is SubmittedFileReference => file !== null);
}
