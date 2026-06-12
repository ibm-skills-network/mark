import * as crypto from "node:crypto";

/**
 * Deterministic storage key for a submission file's extraction artifact.
 * Derivable from fields that survive in a slimmed job payload, so payload
 * consumers can resolve the artifact without re-deriving extraction. The
 * filename is hashed: storage keys must not embed learner-supplied names.
 */
export function provenanceArtifactKey(file: {
  recordId?: number | string;
  questionId?: number;
  filename: string;
}): string {
  const prefix = file.recordId ?? file.questionId ?? "unknown";
  const question = file.questionId ?? "na";
  const filenameHash = crypto
    .createHash("sha256")
    .update(file.filename)
    .digest("hex")
    .slice(0, 32);
  return `provenance/${prefix}/${question}/${filenameHash}.json`;
}
