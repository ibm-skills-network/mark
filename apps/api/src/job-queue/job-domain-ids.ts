// Domain identifiers safe to surface from a decrypted job payload — both to
// admin drill-downs (the failed-jobs view) and to observability spans (the
// worker's Instana tags). IDs only: NEVER userId (an email / PII), never
// payload text, never secrets. A field absent from this list is never exposed,
// even if present in the payload.
//
// This is the SINGLE SOURCE OF TRUTH for that allowlist. It is consumed by both
// apps/api (QueueStatusService) and apps/jobs (instana job tracing); keeping it
// here means the two surfaces can never drift apart and silently start emitting
// a different set of fields.
export const DOMAIN_ID_FIELDS = [
  "assignmentId",
  "attemptId",
  "questionId",
  "variantId",
  "organizationId",
] as const;

// Filters an already-decrypted payload down to the allowlisted scalar IDs.
// Returns {} for anything that isn't a usable object. Callers own decryption
// and its error handling; this is a pure, side-effect-free projection.
export function pickDomainIds(
  payload: unknown,
): Record<string, number | string> {
  if (!payload || typeof payload !== "object") return {};
  const source = payload as Record<string, unknown>;
  const out: Record<string, number | string> = {};
  for (const field of DOMAIN_ID_FIELDS) {
    const value = source[field];
    if (typeof value === "number" || typeof value === "string") {
      out[field] = value;
    }
  }
  return out;
}
