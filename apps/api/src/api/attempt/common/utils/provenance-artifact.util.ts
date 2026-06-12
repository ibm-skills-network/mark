/**
 * Deterministic storage key for a submission file's extraction artifact.
 *
 * Derived from the source object's own storage key, which is already
 * learner-scoped (`${assignmentId}/${userId}/${questionId}/...`). Deriving
 * from learner-supplied ids instead collapses the key to a single global
 * entry per filename in real payloads — those carry neither recordId nor
 * questionId on the file object — so artifacts overwrite each other across
 * learners in the shared bucket. The source key, by contrast, is unique per
 * learner submission.
 *
 * Callers must guard against a missing/empty key before persisting; this
 * throws on an empty key as defense-in-depth so a bad key can never silently
 * produce a colliding `provenance/.json` artifact.
 */
export function provenanceArtifactKey(file: { key: string }): string {
  if (!file.key) {
    throw new Error("provenanceArtifactKey requires a non-empty source key");
  }
  return `provenance/${file.key}.json`;
}
