/**
 * Base class for grading failures that are the submitter's to fix (not
 * transient system faults). The job worker treats these as terminal —
 * never retried — and `learnerMessage` is shown verbatim in the grading
 * modal, so implementations must keep it free of internal jargon.
 */
export abstract class LearnerFacingGradingError extends Error {
  abstract get learnerMessage(): string;
}
