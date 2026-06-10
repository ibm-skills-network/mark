// Uploaded-file references safe to surface from a decrypted job payload — used
// by the admin failed-jobs drill-down to triage "poison files". A FileRef
// describes WHERE a file lives (filename + object-storage coordinates) so the
// read-model can presign a short-lived download URL with S3Service. It carries
// NO learner content, NO userId (an email / PII), no secrets, and no other
// payload text. A field absent from FileRef is never exposed.
//
// This is a pure, side-effect-free projection. It does NOT presign URLs — the
// read-model owns S3Service and the TTL/never-log rules for download links.
// Callers own decryption and its error handling.

// eslint-disable-next-line unicorn/prevent-abbreviations -- public contract name consumed by the read-model and its DTO
export interface FileRef {
  filename: string;
  sizeBytes?: number;
  mimeType?: string;
  bucket?: string;
  storageKey?: string;
}

// The known payload shapes that carry uploaded files:
//
//  - Grading (attempt.grade / author-preview): the file objects hang off
//    updateDto.responsesForQuestions[].learnerFileResponse[]. Each is a
//    LearnerFileUploadWithImages with { filename, mimeType, bucket?, key? }
//    (its object-storage key field is `key`).
//  - Direct file arrays (e.g. an AssignmentFile-shaped entry) carry
//    { filename, mimeType, size, storageKey, storageBucket }. We read those
//    under their own field names so a future direct-file payload is covered.
//
// Anything that doesn't match — wrong type, missing filename, no usable
// storage coordinates — is skipped. Unknown / malformed payloads yield [].

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

// Projects a single file-shaped object down to a FileRef. A FileRef is only
// emitted when there is a usable filename AND at least one storage coordinate
// (bucket or storageKey) — a file with no coordinates can't be downloaded, so
// it has nothing to drill into. Storage key is read from either `key`
// (grading) or `storageKey` (direct), bucket from `bucket` or `storageBucket`.
function toFileReference(value: unknown): FileRef | null {
  const source = asObject(value);
  if (!source) return null;

  const filename = asString(source.filename);
  if (!filename) return null;

  const storageKey = asString(source.key) ?? asString(source.storageKey);
  const bucket = asString(source.bucket) ?? asString(source.storageBucket);
  if (!storageKey && !bucket) return null;

  const reference: FileRef = { filename };
  const mimeType = asString(source.mimeType);
  if (mimeType !== undefined) reference.mimeType = mimeType;
  const sizeBytes =
    asPositiveInt(source.size) ?? asPositiveInt(source.sizeBytes);
  if (sizeBytes !== undefined) reference.sizeBytes = sizeBytes;
  if (bucket !== undefined) reference.bucket = bucket;
  if (storageKey !== undefined) reference.storageKey = storageKey;
  return reference;
}

// Pulls every uploaded-file reference out of an already-decrypted payload.
// Returns [] for anything that isn't a usable object or carries no files.
// eslint-disable-next-line unicorn/prevent-abbreviations -- public contract name consumed by the read-model
export function pickFileRefs(payload: Record<string, unknown>): FileRef[] {
  const root = asObject(payload);
  if (!root) return [];

  const references: FileRef[] = [];

  // Grading shape: updateDto.responsesForQuestions[].learnerFileResponse[].
  const updateDto = asObject(root.updateDto);
  if (updateDto) {
    for (const response of asArray(updateDto.responsesForQuestions)) {
      const responseObject = asObject(response);
      if (!responseObject) continue;
      for (const file of asArray(responseObject.learnerFileResponse)) {
        const reference = toFileReference(file);
        if (reference) references.push(reference);
      }
    }
  }

  // Direct file arrays carried at the payload root.
  for (const field of ["files", "assignmentFiles"] as const) {
    for (const file of asArray(root[field])) {
      const reference = toFileReference(file);
      if (reference) references.push(reference);
    }
  }

  return references;
}
